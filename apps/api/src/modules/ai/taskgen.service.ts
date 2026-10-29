import type { Types } from 'mongoose';
import { z } from 'zod';
import {
  TASK_PRIORITIES,
  type CommitGeneratedTasksInput,
  type GenerateTasksInput,
  type GenerateTasksResultDto,
  type GeneratedTaskDraft,
  type TaskDto,
  type WorkspaceRole,
} from '@nexus/shared';
import { Channel } from '../../models/Channel';
import { DocumentModel } from '../../models/Document';
import { Message } from '../../models/Message';
import type { ProjectLean } from '../../models/Project';
import { Task } from '../../models/Task';
import { recordActivity } from '../../services/activity.service';
import { ApiError } from '../../utils/ApiError';
import { channelAllows } from '../chat/chat.access';
import { assertDocumentAccess } from '../documents/document.service';
import { createNotification } from '../notifications/notification.service';
import { createTask } from '../tasks/task.service';
import { loadUserMap } from '../workspaces/user.lookup';
import { generateStructured, js, workspaceData } from './ai.client';
import { links } from './links';

// ---------- source text ----------

const SOURCE_CHAR_LIMIT = 60_000;

async function sourceText(project: ProjectLean, userId: string, role: WorkspaceRole, input: GenerateTasksInput): Promise<{ label: string; text: string }> {
  if (input.text) return { label: 'text', text: input.text };
  if (input.documentId) {
    const doc = await DocumentModel.findOne({ _id: input.documentId, workspaceId: project.workspaceId }).lean();
    if (!doc) throw ApiError.notFound('Document');
    await assertDocumentAccess(doc, role, userId);
    return { label: `document "${doc.title}"`, text: `${doc.title}\n\n${doc.contentText}` };
  }
  const message = await Message.findOne({ _id: input.messageId, workspaceId: project.workspaceId, deletedAt: null }).lean();
  if (!message) throw ApiError.notFound('Message');
  const channel = await Channel.findById(message.channelId).select('type memberIds name').lean();
  if (!channel || !channelAllows(channel, userId)) throw ApiError.notFound('Message');
  const rootId = message.parentMessageId ?? message._id;
  const thread = await Message.find({ $or: [{ _id: rootId }, { parentMessageId: rootId }], deletedAt: null })
    .sort({ createdAt: 1 })
    .limit(200)
    .lean();
  const users = await loadUserMap(thread.map((m) => m.authorId));
  const lines = thread.map((m) => `${m.authorId ? users.get(m.authorId).name : (m.externalAuthor?.name ?? 'Someone')}: ${m.body}`);
  return { label: `chat thread in #${channel.name}`, text: lines.join('\n') };
}

// ---------- generation ----------

const draftSchema = js.obj({
  draftId: js.str('Short unique id within this batch, e.g. "t1"'),
  title: js.str('Imperative task title, under 100 characters'),
  description: js.str('What done looks like, in 1-4 sentences'),
  priority: js.enumOf(TASK_PRIORITIES),
  assigneeId: js.nullableStr('Id of a listed project member who fits the task, or null'),
  assigneeReason: js.nullableStr('Why that person, in one short sentence, or null'),
  estimateHours: js.num('Rough estimate in hours, or null'),
  dependsOnDraftIds: js.arr(js.str(), 'draftIds of tasks in this batch that must finish first'),
  parentDraftId: js.nullableStr('draftId of the parent when this is a subtask (one level only), or null'),
  labels: js.arr(js.str(), 'Names of existing project labels that apply'),
});
const resultSchema = js.obj({
  summary: js.str('Short plan title, e.g. "Payment system"'),
  tasks: js.arr(draftSchema),
});

const draftValidator = z.object({
  draftId: z.string().min(1).max(64),
  title: z.string().trim().min(1).transform((v) => v.slice(0, 200)),
  description: z.string().transform((v) => v.slice(0, 10000)),
  priority: z.enum(TASK_PRIORITIES),
  assigneeId: z.string().nullable(),
  assigneeReason: z.string().nullable(),
  estimateHours: z.number().nullable(),
  dependsOnDraftIds: z.array(z.string()),
  parentDraftId: z.string().nullable(),
  labels: z.array(z.string()),
});
const resultValidator = z.object({ summary: z.string().transform((v) => v.slice(0, 120)), tasks: z.array(draftValidator) });

const SYSTEM = `You turn requirements, documents and team discussions into a concrete, well-scoped task plan for a software team.
Rules:
- Each task is one deliverable a single person can finish; prefer 2-16 hours of work.
- Use subtasks (parentDraftId) only to split a large task; never nest more than one level.
- Use dependsOnDraftIds only for real ordering constraints.
- Do not repeat work that already exists in the open task list.
- Suggest an assignee only from the member list, matching their title and keeping current load in mind; otherwise null.
- Only use label names from the provided label list.`;

/** Removes invalid references the model may produce; the result is always internally consistent. */
export function sanitizeDrafts(
  drafts: z.infer<typeof draftValidator>[],
  memberIds: Set<string>,
  labelNames: Map<string, string>,
  maxTasks: number,
): GeneratedTaskDraft[] {
  const seen = new Set<string>();
  const kept = drafts.filter((d) => !seen.has(d.draftId) && seen.add(d.draftId)).slice(0, maxTasks);
  const ids = new Set(kept.map((d) => d.draftId));
  const parentOf = new Map(kept.map((d) => [d.draftId, d.parentDraftId && ids.has(d.parentDraftId) && d.parentDraftId !== d.draftId ? d.parentDraftId : null]));

  return kept.map((d) => {
    let parent = parentOf.get(d.draftId) ?? null;
    // One level only: a parent that is itself a subtask is dropped.
    if (parent && parentOf.get(parent)) parent = null;
    const assigneeId = d.assigneeId && memberIds.has(d.assigneeId) ? d.assigneeId : null;
    return {
      draftId: d.draftId,
      title: d.title,
      description: d.description,
      priority: d.priority,
      assigneeId,
      assigneeReason: assigneeId ? d.assigneeReason : null,
      estimateHours: d.estimateHours !== null && d.estimateHours >= 0 ? Math.min(Math.round(d.estimateHours * 2) / 2, 1000) : null,
      dependsOnDraftIds: [...new Set(d.dependsOnDraftIds.filter((id) => ids.has(id) && id !== d.draftId))],
      parentDraftId: parent,
      labels: [...new Set(d.labels.flatMap((l) => labelNames.get(l.toLowerCase()) ?? []))],
    };
  });
}

export async function generateTasks(
  project: ProjectLean,
  userId: string,
  role: WorkspaceRole,
  input: GenerateTasksInput,
): Promise<GenerateTasksResultDto> {
  const source = await sourceText(project, userId, role, input);
  const [users, openTasks, openCounts] = await Promise.all([
    loadUserMap(project.memberIds),
    Task.find({ projectId: project._id, status: { $ne: 'DONE' } }).sort({ updatedAt: -1 }).limit(100).select('key title').lean(),
    Task.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { projectId: project._id, status: { $ne: 'DONE' }, assigneeId: { $ne: null } } },
      { $group: { _id: '$assigneeId', count: { $sum: 1 } } },
    ]),
  ]);
  const load = new Map(openCounts.map((r) => [String(r._id), r.count]));
  const members = project.memberIds.map((id) => {
    const u = users.get(id);
    return { id: u.id, name: u.name, title: u.title, openTasks: load.get(u.id) ?? 0 };
  });

  const prompt = [
    `Project: ${project.name} (key ${project.key})`,
    project.description ? `Project description: ${project.description}` : null,
    `Members: ${JSON.stringify(members)}`,
    `Labels: ${JSON.stringify(project.labels.map((l) => l.name))}`,
    `Existing open tasks: ${JSON.stringify(openTasks.map((t) => `${t.key} ${t.title}`))}`,
    input.instructions ? `Extra instructions from the user: ${input.instructions}` : null,
    `Create at most ${input.maxTasks} tasks from this ${source.label}:`,
    workspaceData(source.label, source.text.slice(0, SOURCE_CHAR_LIMIT)),
  ]
    .filter(Boolean)
    .join('\n\n');

  const result = await generateStructured({
    ctx: { workspaceId: String(project.workspaceId), userId, feature: 'generate_tasks' },
    system: SYSTEM,
    prompt,
    schema: resultSchema,
    validator: resultValidator,
    effort: 'high',
  });

  const labelNames = new Map(project.labels.map((l) => [l.name.toLowerCase(), l.name]));
  return {
    summary: result.summary,
    tasks: sanitizeDrafts(result.tasks, new Set(members.map((m) => m.id)), labelNames, input.maxTasks),
  };
}

// ---------- commit ----------

type DraftInput = CommitGeneratedTasksInput['tasks'][number];

/** Orders drafts so parents and dependencies are created first. Throws on unknown ids or cycles. */
export function orderDrafts(drafts: DraftInput[]): DraftInput[] {
  const byId = new Map(drafts.map((d) => [d.draftId, d]));
  if (byId.size !== drafts.length) throw ApiError.badRequest('Duplicate draftId');
  for (const d of drafts) {
    for (const ref of [...(d.dependsOnDraftIds ?? []), ...(d.parentDraftId ? [d.parentDraftId] : [])]) {
      if (!byId.has(ref)) throw ApiError.badRequest(`Unknown draft reference: ${ref}`);
      if (ref === d.draftId) throw ApiError.badRequest('A task cannot depend on itself');
    }
  }
  const ordered: DraftInput[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (d: DraftInput) => {
    const s = state.get(d.draftId);
    if (s === 'done') return;
    if (s === 'visiting') throw ApiError.badRequest('The selected tasks contain a dependency cycle');
    state.set(d.draftId, 'visiting');
    for (const ref of [...(d.parentDraftId ? [d.parentDraftId] : []), ...(d.dependsOnDraftIds ?? [])]) visit(byId.get(ref) as DraftInput);
    state.set(d.draftId, 'done');
    ordered.push(d);
  };
  drafts.forEach(visit);
  return ordered;
}

export async function commitTasks(project: ProjectLean, actorId: string, input: CommitGeneratedTasksInput): Promise<TaskDto[]> {
  const ordered = orderDrafts(input.tasks);
  const memberIds = new Set(project.memberIds.map(String));
  for (const d of ordered) {
    if (d.assigneeId && !memberIds.has(d.assigneeId)) throw ApiError.badRequest('Assignee must be a member of the project');
  }

  const created = new Map<string, TaskDto>();
  for (const d of ordered) {
    const dto = await createTask(project, actorId, {
      title: d.title,
      description: d.description,
      status: 'TODO',
      priority: d.priority,
      assigneeId: d.assigneeId ?? null,
      estimateHours: d.estimateHours ?? null,
      dueDate: d.dueDate ?? null,
      parentTaskId: d.parentDraftId ? (created.get(d.parentDraftId)?.id ?? null) : null,
      dependsOn: (d.dependsOnDraftIds ?? []).flatMap((id) => created.get(id)?.id ?? []),
    });
    created.set(d.draftId, dto);
  }

  const tasks = input.tasks.flatMap((d) => created.get(d.draftId) ?? []);
  await recordActivity({
    workspaceId: project.workspaceId,
    projectId: project._id,
    actorId,
    type: 'AI_TASKS_GENERATED',
    target: { type: 'project', id: project._id, title: project.name },
    metadata: { count: tasks.length, source: input.source?.type ?? 'text', sourceId: input.source?.id ?? null, keys: tasks.map((t) => t.key) },
  });
  await Promise.all(
    tasks
      .filter((t) => t.assignee)
      .map((t) =>
        createNotification({
          userId: t.assignee?.id as string,
          workspaceId: t.workspaceId,
          type: 'AI_TASK_CREATED',
          title: `New task for you: ${t.key} ${t.title}`,
          body: 'Created from an AI-generated plan',
          link: links.task(t.workspaceId, t.projectId, t.id),
          actorId,
          entity: { type: 'task', id: t.id },
        }),
      ),
  );
  return tasks;
}
