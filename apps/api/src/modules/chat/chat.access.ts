import type { Request, RequestHandler } from 'express';
import { Types } from 'mongoose';
import { hasPermission, type Permission } from '@nexus/shared';
import { getAuthUser, getMemberRole } from '../../middleware/authorize';
import { Channel } from '../../models/Channel';
import { Message } from '../../models/Message';
import { ApiError } from '../../utils/ApiError';
import type { ChannelLean, MessageLean } from './chat.dto';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      channel?: ChannelLean;
      message?: MessageLean;
    }
  }
}

/** PUBLIC → any workspace member; PRIVATE/GROUP/DM → listed participants. */
export function channelAllows(channel: Pick<ChannelLean, 'type' | 'memberIds'>, userId: string): boolean {
  if (channel.type === 'PUBLIC') return true;
  return channel.memberIds.some((m) => String(m) === userId);
}

function paramId(req: Request, name: string): string {
  const id = req.params[name];
  if (!id || !Types.ObjectId.isValid(id)) throw ApiError.notFound();
  return id;
}

export interface ChannelAccessOptions {
  /** Let `channel:manage` holders through even when they are not participants (member management). */
  allowManagers?: boolean;
}

async function authorizeChannel(
  req: Request,
  channel: ChannelLean,
  permission: Permission | 'member',
  options: ChannelAccessOptions,
): Promise<void> {
  const user = getAuthUser(req);
  const workspaceId = String(channel.workspaceId);
  const role = await getMemberRole(workspaceId, user.id);
  // Non-members get 404 so channel ids do not leak across workspaces.
  if (!role) throw ApiError.notFound('Channel');
  const manager = options.allowManagers === true && hasPermission(role, 'channel:manage');
  if (!channelAllows(channel, user.id) && !manager) throw ApiError.forbidden('You do not have access to this channel');
  if (permission !== 'member' && !hasPermission(role, permission)) throw ApiError.forbidden();
  req.workspace = { id: workspaceId, role };
  req.channel = channel;
}

/**
 * Loads `/channels/:id`, verifies the caller is a workspace member with access to the channel
 * (and optionally holds `permission`), then attaches `req.channel` and `req.workspace`.
 */
export function requireChannelAccess(
  permission: Permission | 'member' = 'member',
  options: ChannelAccessOptions = {},
): RequestHandler {
  return async (req, _res, next) => {
    try {
      const channel = await Channel.findById(paramId(req, 'id')).lean();
      if (!channel) throw ApiError.notFound('Channel');
      await authorizeChannel(req, channel, permission, options);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Same as `requireChannelAccess`, but for `/messages/:id`: also attaches `req.message`. */
export function requireMessageAccess(permission: Permission | 'member' = 'member'): RequestHandler {
  return async (req, _res, next) => {
    try {
      const message = await Message.findById(paramId(req, 'id')).lean();
      if (!message) throw ApiError.notFound('Message');
      const channel = await Channel.findById(message.channelId).lean();
      if (!channel) throw ApiError.notFound('Channel');
      await authorizeChannel(req, channel, permission, {});
      req.message = message;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function getChannelContext(req: Request): ChannelLean {
  if (!req.channel) throw ApiError.internal('Channel context missing');
  return req.channel;
}

export function getMessageContext(req: Request): MessageLean {
  if (!req.message) throw ApiError.internal('Message context missing');
  return req.message;
}
