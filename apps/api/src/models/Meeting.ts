import mongoose, { Schema, type Model, type Types } from 'mongoose';
import type { MeetingAnalysisDto, MeetingDto } from '@nexus/shared';

export const MEETING_STATUSES = ['PENDING', 'PROCESSING', 'READY', 'FAILED'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export interface IMeeting {
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId | null;
  title: string;
  occurredAt: Date;
  transcript: string;
  attendeeIds: Types.ObjectId[];
  status: MeetingStatus;
  error: string | null;
  /** Shape of MeetingAnalysisDto (action items carry generated ids). */
  analysis: MeetingAnalysisDto | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type MeetingLean = IMeeting & { _id: Types.ObjectId };

const meetingSchema = new Schema<IMeeting>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    occurredAt: { type: Date, required: true },
    transcript: { type: String, required: true },
    attendeeIds: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
    status: { type: String, enum: MEETING_STATUSES, default: 'PENDING' },
    error: { type: String, default: null },
    analysis: { type: Schema.Types.Mixed, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, minimize: false },
);

meetingSchema.index({ workspaceId: 1, occurredAt: -1 });
meetingSchema.index({ projectId: 1, occurredAt: -1 });

export const Meeting =
  (mongoose.models.Meeting as Model<IMeeting>) ?? mongoose.model<IMeeting>('Meeting', meetingSchema);

export type MeetingDtoUsers = Pick<MeetingDto, 'attendees' | 'createdBy'>;

export function toMeetingDto(m: MeetingLean, users: MeetingDtoUsers): MeetingDto {
  return {
    id: String(m._id),
    workspaceId: String(m.workspaceId),
    projectId: m.projectId ? String(m.projectId) : null,
    title: m.title,
    occurredAt: m.occurredAt.toISOString(),
    attendees: users.attendees,
    status: m.status,
    error: m.error ?? null,
    analysis: m.analysis ?? null,
    createdBy: users.createdBy,
    createdAt: m.createdAt.toISOString(),
  };
}
