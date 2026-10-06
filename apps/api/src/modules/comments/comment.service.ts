import { Types } from 'mongoose';
import {
  ROLE_RANK,
  type CommentDto,
  type CreateCommentInput,
  type PaginationMeta,
  type PaginationQuery,
  type UpdateCommentInput,
  type WorkspaceRole,
} from '@nexus/shared';
import { events } from '../../events';
import { Comment, toCommentDto, type CommentLean } from '../../models/Comment';
import type { ProjectLean } from '../../models/Project';
import type { TaskLean } from '../../models/Task';
import { recordActivity } from '../../services/activity.service';
import { ApiError } from '../../utils/ApiError';
import { paginationMeta } from '../../utils/response';
import { loadUserMap } from '../workspaces/user.lookup';
import { buildTaskDto } from '../tasks/task.service';
import { filterWorkspaceMembers } from '../workspaces/workspace.service';

export async function buildCommentDtos(comments: CommentLean[]): Promise<CommentDto[]> {
  if (comments.length === 0) return [];
  const users = await loadUserMap(comments.map((c) => c.authorId));
  return comments.map((c) => toCommentDto(c, users.get(c.authorId)));
}

/** Oldest first. */
export async function listComments(
  task: TaskLean,
  query: PaginationQuery,
): Promise<{ items: CommentDto[]; meta: PaginationMeta }> {
  const { page, limit } = query;
  const filter = { taskId: task._id };
  const [total, comments] = await Promise.all([
    Comment.countDocuments(filter),
    Comment.find(filter)
      .sort({ createdAt: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);
  return { items: await buildCommentDtos(comments), meta: paginationMeta(page, limit, total) };
}

export async function createComment(
  task: TaskLean,
  project: ProjectLean,
  actorId: string,
  input: CreateCommentInput,
): Promise<CommentDto> {
  const mentions = await filterWorkspaceMembers(project.workspaceId, input.mentions ?? []);

  const comment = await Comment.create({
    workspaceId: project.workspaceId,
    projectId: project._id,
    taskId: task._id,
    authorId: new Types.ObjectId(actorId),
    body: input.body,
    mentions: mentions.map((id) => new Types.ObjectId(id)),
  });

  await recordActivity({
    workspaceId: project.workspaceId,
    projectId: project._id,
    actorId,
    type: 'COMMENT_ADDED',
    target: { type: 'task', id: task._id, title: task.title },
    metadata: { key: task.key, commentId: String(comment._id), mentions },
  });

  const users = await loadUserMap([actorId]);
  const dto = toCommentDto(comment.toObject(), users.get(actorId));
  events.emit('comment.created', { comment: dto, task: await buildTaskDto(task, project), actorId });
  return dto;
}

/** Author only. */
export async function updateComment(
  comment: CommentLean,
  task: TaskLean,
  actorId: string,
  input: UpdateCommentInput,
): Promise<CommentDto> {
  if (String(comment.authorId) !== actorId) {
    throw ApiError.forbidden('Only the author can edit a comment');
  }

  const editedAt = new Date();
  await Comment.updateOne({ _id: comment._id }, { $set: { body: input.body, editedAt } });

  await recordActivity({
    workspaceId: comment.workspaceId,
    projectId: comment.projectId,
    actorId,
    type: 'COMMENT_UPDATED',
    target: { type: 'task', id: task._id, title: task.title },
    metadata: { key: task.key, commentId: String(comment._id) },
  });

  const users = await loadUserMap([comment.authorId]);
  return toCommentDto({ ...comment, body: input.body, editedAt }, users.get(comment.authorId));
}

/** Author, or MANAGER and above. */
export async function deleteComment(
  comment: CommentLean,
  task: TaskLean,
  actorId: string,
  role: WorkspaceRole,
): Promise<void> {
  const isAuthor = String(comment.authorId) === actorId;
  if (!isAuthor && ROLE_RANK[role] < ROLE_RANK.MANAGER) {
    throw ApiError.forbidden('Only the author or a manager can delete this comment');
  }

  await Comment.deleteOne({ _id: comment._id });

  await recordActivity({
    workspaceId: comment.workspaceId,
    projectId: comment.projectId,
    actorId,
    type: 'COMMENT_DELETED',
    target: { type: 'task', id: task._id, title: task.title },
    metadata: { key: task.key, commentId: String(comment._id), authorId: String(comment.authorId) },
  });
}
