import { Types, type FilterQuery } from 'mongoose';
import type {
  NotificationDto,
  NotificationListQuery,
  NotificationType,
  PaginationMeta,
  UnreadCountDto,
  UserPublicDto,
} from '@nexus/shared';
import { cache } from '../../config/redis';
import { logger } from '../../config/logger';
import { events } from '../../events';
import { enqueue } from '../../jobs';
import { Notification, type INotification, type NotificationEntityType } from '../../models/Notification';
import { User } from '../../models/User';
import { realtime } from '../../sockets';
import { ApiError } from '../../utils/ApiError';
import { paginationMeta } from '../../utils/response';
import { loadUserMap } from '../workspaces/user.lookup';

export type NotificationLean = INotification & { _id: Types.ObjectId };

/** Identical `(user, type, entity, actor)` notifications within this window are collapsed. */
const DEDUPE_TTL_SEC = 60;

export interface CreateNotificationInput {
  userId: string;
  workspaceId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  actorId?: string | null;
  entity?: { type: NotificationEntityType; id: string } | null;
}

export function toNotificationDto(n: NotificationLean, actor: UserPublicDto | null): NotificationDto {
  return {
    id: String(n._id),
    workspaceId: String(n.workspaceId),
    type: n.type,
    title: n.title,
    body: n.body ?? null,
    link: n.link ?? null,
    actor,
    entity: n.entity ? { type: n.entity.type, id: String(n.entity.id) } : null,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  };
}

async function buildDtos(items: NotificationLean[]): Promise<NotificationDto[]> {
  if (items.length === 0) return [];
  const users = await loadUserMap(items.map((n) => n.actorId));
  return items.map((n) => toNotificationDto(n, users.getOrNull(n.actorId)));
}

const dedupeKey = (i: CreateNotificationInput) =>
  `notif:dedupe:${i.userId}:${i.type}:${i.entity?.id ?? 'none'}:${i.actorId ?? 'system'}`;

/**
 * The single write path for notifications. Never notifies the actor about their own action,
 * respects the user's `inApp` preference, collapses repeats within 60 s, emits
 * `notification.created` and queues delivery (email / Slack). Returns null when nothing was created.
 * Never throws: a notification failure must not fail the mutation that triggered it.
 */
export async function createNotification(input: CreateNotificationInput): Promise<NotificationDto | null> {
  try {
    if (input.actorId && input.actorId === input.userId) return null;

    const user = await User.findById(input.userId).select('preferences deletedAt').lean();
    if (!user || user.deletedAt || !user.preferences.notifications.inApp) return null;

    const key = dedupeKey(input);
    if (await cache.get<boolean>(key)) return null;
    await cache.set(key, true, DEDUPE_TTL_SEC);

    const doc = await Notification.create({
      userId: new Types.ObjectId(input.userId),
      workspaceId: new Types.ObjectId(input.workspaceId),
      type: input.type,
      title: input.title.slice(0, 200),
      body: input.body ? input.body.slice(0, 1000) : null,
      link: input.link ?? null,
      actorId: input.actorId ? new Types.ObjectId(input.actorId) : null,
      entity: input.entity ? { type: input.entity.type, id: new Types.ObjectId(input.entity.id) } : null,
    });

    const [dto] = await buildDtos([doc.toObject()]);
    if (!dto) return null;
    events.emit('notification.created', { notification: dto, userId: input.userId });
    await enqueue('notification.deliver', { notificationId: dto.id });
    return dto;
  } catch (err) {
    logger.error({ err, type: input.type, userId: input.userId }, 'Failed to create notification');
    return null;
  }
}

// ---------- queries ----------

export async function listNotifications(
  userId: string,
  query: NotificationListQuery,
): Promise<{ items: NotificationDto[]; meta: PaginationMeta }> {
  const filter: FilterQuery<INotification> = { userId: new Types.ObjectId(userId) };
  if (query.unread) filter.readAt = null;
  if (query.workspaceId && Types.ObjectId.isValid(query.workspaceId)) filter.workspaceId = new Types.ObjectId(query.workspaceId);

  const { page, limit } = query;
  const [total, items] = await Promise.all([
    Notification.countDocuments(filter),
    Notification.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);
  return { items: await buildDtos(items), meta: paginationMeta(page, limit, total) };
}

export async function unreadCount(userId: string): Promise<UnreadCountDto> {
  const rows = await Notification.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { userId: new Types.ObjectId(userId), readAt: null } },
    { $group: { _id: '$workspaceId', count: { $sum: 1 } } },
  ]);
  const byWorkspace: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    byWorkspace[String(row._id)] = row.count;
    total += row.count;
  }
  return { total, byWorkspace };
}

// ---------- mutations ----------
// Read receipts have no domain event of their own (nothing else reacts to them), so the service
// pushes `notification:read` to the owner's sockets directly.

export async function markRead(userId: string, notificationId: string): Promise<NotificationDto> {
  const n = await Notification.findOne({ _id: notificationId, userId }).lean();
  if (!n) throw ApiError.notFound('Notification');

  if (!n.readAt) {
    const readAt = new Date();
    await Notification.updateOne({ _id: n._id }, { $set: { readAt } });
    n.readAt = readAt;
    realtime.toUser(userId, 'notification:read', { ids: [String(n._id)] });
  }
  const [dto] = await buildDtos([n]);
  if (!dto) throw ApiError.internal();
  return dto;
}

export async function markAllRead(userId: string, workspaceId?: string): Promise<{ updated: number }> {
  const filter: FilterQuery<INotification> = { userId: new Types.ObjectId(userId), readAt: null };
  if (workspaceId) filter.workspaceId = new Types.ObjectId(workspaceId);
  const result = await Notification.updateMany(filter, { $set: { readAt: new Date() } });
  realtime.toUser(userId, 'notification:read', { ids: [], all: true });
  return { updated: result.modifiedCount };
}

export async function deleteNotification(userId: string, notificationId: string): Promise<void> {
  const result = await Notification.deleteOne({ _id: notificationId, userId });
  if (result.deletedCount === 0) throw ApiError.notFound('Notification');
}
