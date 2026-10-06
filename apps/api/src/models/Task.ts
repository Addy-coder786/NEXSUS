import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type LabelDto,
  type TaskDto,
  type TaskPriority,
  type TaskStatus,
  type UserPublicDto,
} from '@nexus/shared';

export interface IChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface ITask {
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  number: number;
  key: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  position: number;
  assigneeId: Types.ObjectId | null;
  createdBy: Types.ObjectId;
  labelIds: Types.ObjectId[];
  dueDate: Date | null;
  startDate: Date | null;
  estimateHours: number | null;
  parentTaskId: Types.ObjectId | null;
  checklist: IChecklistItem[];
  dependsOn: Types.ObjectId[];
  completedAt: Date | null;
  /** Deadline reminder flags set by the deadline scanner so each reminder fires once. */
  reminders?: { dueSoonAt: Date | null; overdueAt: Date | null };
  createdAt: Date;
  updatedAt: Date;
}

export type TaskDocument = HydratedDocument<ITask>;
export type TaskLean = ITask & { _id: Types.ObjectId };

export const POSITION_GAP = 1024;

const checklistItemSchema = new Schema<IChecklistItem>(
  {
    id: { type: String, required: true },
    text: { type: String, required: true, trim: true, maxlength: 200 },
    done: { type: Boolean, default: false },
  },
  { _id: false },
);

const taskSchema = new Schema<ITask>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    number: { type: Number, required: true },
    key: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: null, maxlength: 10000 },
    status: { type: String, enum: TASK_STATUSES, default: 'TODO' },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'MEDIUM' },
    position: { type: Number, required: true, default: POSITION_GAP },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    labelIds: { type: [Schema.Types.ObjectId], default: [] },
    dueDate: { type: Date, default: null },
    startDate: { type: Date, default: null },
    estimateHours: { type: Number, default: null },
    parentTaskId: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
    checklist: { type: [checklistItemSchema], default: [] },
    dependsOn: { type: [{ type: Schema.Types.ObjectId, ref: 'Task' }], default: [] },
    completedAt: { type: Date, default: null },
    reminders: {
      type: { dueSoonAt: { type: Date, default: null }, overdueAt: { type: Date, default: null } },
      default: () => ({ dueSoonAt: null, overdueAt: null }),
    },
  },
  { timestamps: true },
);

taskSchema.index({ projectId: 1, status: 1, position: 1 });
taskSchema.index({ projectId: 1, number: 1 }, { unique: true });
taskSchema.index({ workspaceId: 1, assigneeId: 1 });
taskSchema.index({ projectId: 1, parentTaskId: 1 });
taskSchema.index({ title: 'text', description: 'text' });

export const Task =
  (mongoose.models.Task as Model<ITask>) ?? mongoose.model<ITask>('Task', taskSchema);

export interface TaskDtoExtras {
  assignee: UserPublicDto | null;
  createdBy: UserPublicDto;
  labels: LabelDto[];
  subtaskCount: number;
  subtaskDoneCount: number;
  commentCount: number;
}

export function toTaskDto(t: TaskLean, extras: TaskDtoExtras): TaskDto {
  return {
    id: String(t._id),
    projectId: String(t.projectId),
    workspaceId: String(t.workspaceId),
    number: t.number,
    key: t.key,
    title: t.title,
    description: t.description ?? null,
    status: t.status,
    priority: t.priority,
    position: t.position,
    assignee: extras.assignee,
    createdBy: extras.createdBy,
    labels: extras.labels,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    startDate: t.startDate ? t.startDate.toISOString() : null,
    estimateHours: t.estimateHours ?? null,
    parentTaskId: t.parentTaskId ? String(t.parentTaskId) : null,
    subtaskCount: extras.subtaskCount,
    subtaskDoneCount: extras.subtaskDoneCount,
    checklist: t.checklist.map((c) => ({ id: c.id, text: c.text, done: c.done })),
    dependsOn: t.dependsOn.map((d) => String(d)),
    commentCount: extras.commentCount,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
