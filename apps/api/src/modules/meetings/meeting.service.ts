import { randomUUID } from 'node:crypto';
import { Types, type FilterQuery } from 'mongoose';
import { z } from 'zod';
import {
  TASK_PRIORITIES,
  type CreateMeetingInput,
  type MeetingActionItemDto,
  type MeetingAnalysisDto,
  type MeetingDetailDto,
  type MeetingDto,
  type PaginationMeta,
  type TaskDto,
  type UserPublicDto,
  type WorkspaceRole,
} from '@nexus/shared';
import { features } from '../../config/env';
import { logger } from '../../config/logger';
import { canSeeAllProjects, hasProjectAccess } from '../../middleware/authorize';
import { defineJob, enqueue } from '../../jobs';
import { Chunk } from '../../models/Chunk';
import { Meeting, toMeetingDto, type IMeeting, type MeetingLean } from '../../models/Meeting';
import { Project, type ProjectLean } from '../../models/Project';
import { WorkspaceMember } from '../../models/WorkspaceMember';
import { recordActivity } from '../../services/activity.service';
import { ApiError } from '../../utils/ApiError';
import { paginationMeta } from '../../utils/response';
import { generateStructured, js, toApiError, workspaceData } from '../ai/ai.client';
import { links } from '../ai/links';
import { createNotification } from '../notifications/notification.service';
import { createTask } from '../tasks/task.service';
import { assertWorkspaceMembers } from '../workspaces/workspace.service';
import { loadUserMap } from '../workspaces/user.lookup';

export const AI_OFF_ERROR = 'AI is not configured';
/** A PROCESSING meeting older than this is treated as abandoned (e.g. the worker crashed). */
const STALE_PROCESSING_MS = 10 * 60 * 1000;
const isStale = (m: Pick<MeetingLean, 'updatedAt'>) => Date.now() - m.updatedAt.getTime() > STALE_PROCESSING_MS;

// ---------- DTOs ----------

async function buildMeetingDtos(meetings: MeetingLean[]): Promise<MeetingDto[]> {
  const users = await loadUserMap(meetings.flatMap((m) => [m.createdBy, ...m.attendeeIds]));
  return meetings.map((m) => toMeetingDto(m, { attendees: m.attendeeIds.map((id) => users.get(id)), createdBy: users.get(m.createdBy) }));
}

export async function buildMeetingDto(meeting: MeetingLean): Promise<MeetingDto> {
  const [dto] = await buildMeetingDtos([meeting]);
  if (!dto) throw ApiError.internal();
  return dto;
}

export async function buildMeetingDetail(meeting: MeetingLean): Promise<MeetingDetailDto> {
  return { ...(await buildMeetingDto(meeting)), transcript: meeting.transcript };
}

// ---------- access ----------

export async function loadMeeting(id: string): Promise<MeetingLean> {
  if (!Types.ObjectId.isValid(id)) throw ApiError.notFound('Meeting');
  const meeting = await Meeting.findById(id).lean();
  if (!meeting) throw ApiError.notFound('Meeting');
  return meeting;
}

/** Project-scoped meetings are only visible to users who can access the project. */
export async function assertMeetingAccess(meeting: MeetingLean, role: WorkspaceRole, userId: string): Promise<void> {
  if (!meeting.projectId || canSeeAllProjects(role)) return;
  const project = await Project.findById(meeting.projectId).select('memberIds').lean();
  if (!project || !hasProjectAccess(project, role, userId)) throw ApiError.forbidden('You are not a member of this project');
}

export function canDeleteMeeting(meeting: MeetingLean, userId: string, canDeleteAny: boolean): boolean {
  return canDeleteAny || String(meeting.createdBy) === userId;
}

// ---------- list / create / delete ----------

export async function listMeetings(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
  query: { page: number; limit: number; projectId?: string },
): Promise<{ items: MeetingDto[]; meta: PaginationMeta }> {
  const filter: FilterQuery<IMeeting> = { workspaceId: new Types.ObjectId(workspaceId) };
  if (query.projectId) {
    const project = await Project.findOne({ _id: query.projectId, workspaceId }).select('memberIds').lean();
    if (!project) throw ApiError.notFound('Project');
    if (!hasProjectAccess(project, role, userId)) throw ApiError.forbidden('You are not a member of this project');
    filter.projectId = project._id;
  } else if (!canSeeAllProjects(role)) {
    const projects = await Project.find({ workspaceId, memberIds: new Types.ObjectId(userId) }).select('_id').lean();
    filter.$or = [{ projectId: null }, { projectId: { $in: projects.map((p) => p._id) } }];
  }
  const { page, limit } = query;
  const [total, rows] = await Promise.all([
    Meeting.countDocuments(filter),
    Meeting.find(filter)
      .select('-transcript')
      .sort({ occurredAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);
  return { items: await buildMeetingDtos(rows as MeetingLean[]), meta: paginationMeta(page, limit, total) };
}

export async function createMeeting(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
  input: CreateMeetingInput,
): Promise<MeetingDto> {
  let projectId: Types.ObjectId | null = null;
  if (input.projectId) {
    const project = await Project.findOne({ _id: input.projectId, workspaceId }).select('memberIds').lean();
    if (!project) throw ApiError.badRequest('Project not found in this workspace');
    if (!hasProjectAccess(project, role, userId)) throw ApiError.forbidden('You are not a member of this project');
    projectId = project._id;
  }
  const attendeeIds = [...new Set(input.attendeeIds ?? [])];
  await assertWorkspaceMembers(workspaceId, attendeeIds);

  const meeting = await Meeting.create({
    workspaceId: new Types.ObjectId(workspaceId),
    projectId,
    title: input.title,
    occurredAt: input.occurredAt ?? new Date(),
    transcript: input.transcript,
    attendeeIds: attendeeIds.map((id) => new Types.ObjectId(id)),
    status: features.ai ? 'PENDING' : 'FAILED',
    error: features.ai ? null : AI_OFF_ERROR,
    createdBy: new Types.ObjectId(userId),
  });

  await recordActivity({
    workspaceId,
    projectId,
    actorId: userId,
    type: 'MEETING_CREATED',
    target: { type: 'meeting', id: meeting._id, title: meeting.title },
  });
  // The transcript is searchable even before (or without) analysis.
  await enqueue('rag.index', { sourceType: 'meeting', sourceId: String(meeting._id) });
  if (features.ai) await enqueue('meeting.analyze', { meetingId: String(meeting._id) });

  return buildMeetingDto(await loadMeeting(String(meeting._id)));
}

export async function reanalyzeMeeting(meeting: MeetingLean): Promise<MeetingDto> {
  if (meeting.status === 'PROCESSING' && !isStale(meeting)) throw ApiError.conflict('This meeting is already being analysed');
  await Meeting.updateOne({ _id: meeting._id }, { status: 'PENDING', error: null });
  await enqueue('meeting.analyze', { meetingId: String(meeting._id) });
  return buildMeetingDto(await loadMeeting(String(meeting._id)));
}

export async function deleteMeeting(meeting: MeetingLean): Promise<void> {
  await Promise.all([
    Meeting.deleteOne({ _id: meeting._id }),
    Chunk.deleteMany({ sourceType: 'meeting', sourceId: meeting._id }),
  ]);
}

// ---------- analysis ----------

const TRANSCRIPT_CHAR_LIMIT = 200_000;

const analysisSchema = js.obj({
  summary: js.str('3-6 sentence summary of the meeting'),
  decisions: js.arr(js.obj({ text: js.str('The decision'), context: js.nullableStr('Why, or what it depends on; null if not stated') })),
  actionItems: js.arr(
    js.obj({
      text: js.str('The action, phrased as a task title'),
      ownerName: js.nullableStr('Name of the person who took it on, exactly as spoken; null if nobody did'),
      dueHint: js.nullableStr('Any deadline mentioned ("by Friday", "next sprint"), or null'),
      priority: js.enumOf(TASK_PRIORITIES),
    }),
  ),
  openQuestions: js.arr(js.str()),
  risks: js.arr(js.str()),
});

const clip = (max: number) => z.string().transform((v) => v.slice(0, max));
const analysisValidator = z.object({
  summary: clip(4000),
  decisions: z.array(z.object({ text: clip(500), context: z.string().nullable() })).transform((v) => v.slice(0, 30)),
  actionItems: z
    .array(z.object({ text: z.string().trim().min(1).transform((v) => v.slice(0, 200)), ownerName: z.string().nullable(), dueHint: z.string().nullable(), priority: z.enum(TASK_PRIORITIES) }))
    .transform((v) => v.slice(0, 50)),
  openQuestions: z.array(clip(500)).transform((v) => v.slice(0, 20)),
  risks: z.array(clip(500)).transform((v) => v.slice(0, 20)),
});

const SYSTEM = `You analyse meeting transcripts and notes for a software team.
Extract only what was actually said: the decisions made, the action items people committed to, open questions and risks.
Action items are concrete follow-ups; give the owner's name only when someone clearly took the item on.
Keep the wording close to the transcript and do not invent deadlines.`;

/** Case-insensitive full-name match first, then a unique first-name match. Attendees win ties. */
export function resolveOwner(name: string | null, members: UserPublicDto[], attendeeIds: Set<string>): string | null {
  if (!name) return null;
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const full = members.filter((m) => m.name.trim().toLowerCase() === needle);
  const candidates = full.length ? full : members.filter((m) => m.name.trim().toLowerCase().split(/\s+/)[0] === needle.split(/\s+/)[0]);
  if (candidates.length === 1) return candidates[0]?.id ?? null;
  const attending = candidates.filter((m) => attendeeIds.has(m.id));
  return attending.length === 1 ? (attending[0]?.id ?? null) : null;
}

export async function analyzeMeeting(meetingId: string): Promise<void> {
  const meeting = await Meeting.findOneAndUpdate(
    { _id: meetingId, $or: [{ status: { $ne: 'PROCESSING' } }, { updatedAt: { $lt: new Date(Date.now() - STALE_PROCESSING_MS) } }] },
    { status: 'PROCESSING', error: null },
    { new: true },
  ).lean();
  if (!meeting) return;

  try {
    const [members, attendees] = await Promise.all([
      WorkspaceMember.find({ workspaceId: meeting.workspaceId }).select('userId').lean(),
      loadUserMap(meeting.attendeeIds),
    ]);
    const users = await loadUserMap(members.map((m) => m.userId));
    const memberDtos = members.map((m) => users.get(m.userId));
    const attendeeNames = meeting.attendeeIds.map((id) => attendees.get(id).name);

    const result = await generateStructured({
      ctx: { workspaceId: String(meeting.workspaceId), userId: String(meeting.createdBy), feature: 'meeting_analysis' },
      system: SYSTEM,
      prompt: [
        `Meeting: ${meeting.title} (${meeting.occurredAt.toISOString().slice(0, 10)})`,
        attendeeNames.length ? `Attendees: ${attendeeNames.join(', ')}` : null,
        workspaceData('meeting transcript', meeting.transcript.slice(0, TRANSCRIPT_CHAR_LIMIT)),
      ]
        .filter(Boolean)
        .join('\n\n'),
      schema: analysisSchema,
      validator: analysisValidator,
      effort: 'high',
    });

    const attendeeSet = new Set(meeting.attendeeIds.map(String));
    const analysis: MeetingAnalysisDto = {
      summary: result.summary,
      decisions: result.decisions,
      actionItems: result.actionItems.map(
        (item): MeetingActionItemDto => ({
          id: randomUUID(),
          text: item.text,
          ownerName: item.ownerName,
          ownerId: resolveOwner(item.ownerName, memberDtos, attendeeSet),
          dueHint: item.dueHint,
          priority: item.priority,
          taskId: null,
        }),
      ),
      openQuestions: result.openQuestions,
      risks: result.risks,
    };

    await Meeting.updateOne({ _id: meeting._id }, { status: 'READY', error: null, analysis });
    await recordActivity({
      workspaceId: meeting.workspaceId,
      projectId: meeting.projectId,
      actorId: meeting.createdBy,
      type: 'MEETING_ANALYZED',
      target: { type: 'meeting', id: meeting._id, title: meeting.title },
      metadata: { actionItems: analysis.actionItems.length, decisions: analysis.decisions.length },
    });
    await enqueue('rag.index', { sourceType: 'meeting', sourceId: String(meeting._id) });
    await createNotification({
      userId: String(meeting.createdBy),
      workspaceId: String(meeting.workspaceId),
      type: 'AI_TASK_CREATED',
      title: `Meeting notes ready: ${meeting.title}`,
      body: `${analysis.actionItems.length} action items, ${analysis.decisions.length} decisions`,
      link: links.meeting(String(meeting.workspaceId), String(meeting._id)),
      actorId: null,
      entity: { type: 'meeting', id: String(meeting._id) },
    });
  } catch (err) {
    const safe = toApiError(err).message;
    logger.warn({ err, meetingId }, 'Meeting analysis failed');
    await Meeting.updateOne({ _id: meeting._id }, { status: 'FAILED', error: safe });
  }
}

defineJob('meeting.analyze', async ({ meetingId }) => {
  await analyzeMeeting(meetingId);
});

// ---------- convert action items ----------

export async function convertActionItems(
  meeting: MeetingLean,
  project: ProjectLean,
  actorId: string,
  actionItemIds: string[],
): Promise<TaskDto[]> {
  if (!meeting.analysis) throw ApiError.badRequest('This meeting has not been analysed yet');
  if (String(project.workspaceId) !== String(meeting.workspaceId)) throw ApiError.badRequest('Project not found in this workspace');
  if (meeting.projectId && String(meeting.projectId) !== String(project._id)) {
    throw ApiError.badRequest('Action items can only be converted into the meeting’s project');
  }

  const wanted = new Set(actionItemIds);
  const items = meeting.analysis.actionItems.filter((i) => wanted.has(i.id));
  if (items.length !== wanted.size) throw ApiError.badRequest('Unknown action item');
  if (items.some((i) => i.taskId)) throw ApiError.conflict('Some action items were already converted');

  const projectMembers = new Set(project.memberIds.map(String));
  const meetingLink = links.meeting(String(meeting.workspaceId), String(meeting._id));
  const created = new Map<string, TaskDto>();
  for (const item of items) {
    const description = [
      `From the meeting “${meeting.title}” (${meeting.occurredAt.toISOString().slice(0, 10)}).`,
      item.ownerName ? `Owner mentioned: ${item.ownerName}.` : null,
      item.dueHint ? `Timing mentioned: ${item.dueHint}.` : null,
      `Meeting notes: ${meetingLink}`,
    ]
      .filter(Boolean)
      .join('\n');
    const task = await createTask(project, actorId, {
      title: item.text,
      description,
      status: 'TODO',
      priority: item.priority,
      assigneeId: item.ownerId && projectMembers.has(item.ownerId) ? item.ownerId : null,
    });
    created.set(item.id, task);
  }

  const analysis: MeetingAnalysisDto = {
    ...meeting.analysis,
    actionItems: meeting.analysis.actionItems.map((i) => ({ ...i, taskId: created.get(i.id)?.id ?? i.taskId })),
  };
  await Meeting.updateOne({ _id: meeting._id }, { analysis });
  return items.flatMap((i) => created.get(i.id) ?? []);
}
