import { Types } from 'mongoose';
import type { ActivityTargetType, ActivityType } from '@nexus/shared';
import { logger } from '../config/logger';
import { events } from '../events';
import { Activity, toActivityDto, type IActivityTarget } from '../models/Activity';
import { loadUser } from '../modules/workspaces/user.lookup';

export interface ActivityTargetInput {
  type: ActivityTargetType;
  id: unknown;
  title: string;
}

export interface RecordActivityInput {
  workspaceId: Types.ObjectId | string;
  projectId?: Types.ObjectId | string | null;
  actorId: Types.ObjectId | string;
  type: ActivityType;
  target?: ActivityTargetInput | null;
  metadata?: Record<string, unknown>;
}

function toObjectId(value: Types.ObjectId | string): Types.ObjectId {
  return value instanceof Types.ObjectId ? value : new Types.ObjectId(value);
}

/**
 * The single write path for the activity log. Never throws: a logging failure must not fail
 * the mutation that triggered it.
 */
export async function recordActivity(input: RecordActivityInput): Promise<void> {
  try {
    const target: IActivityTarget | null = input.target
      ? { type: input.target.type, id: String(input.target.id), title: input.target.title }
      : null;

    const activity = await Activity.create({
      workspaceId: toObjectId(input.workspaceId),
      projectId: input.projectId ? toObjectId(input.projectId) : null,
      actorId: toObjectId(input.actorId),
      type: input.type,
      target,
      metadata: input.metadata ?? {},
    });

    // Same mapper the activity feeds use, so socket payloads match GET /activities.
    const actor = await loadUser(activity.actorId);
    events.emit('activity.recorded', { activity: toActivityDto(activity.toObject(), actor) });
  } catch (err) {
    logger.error({ err, type: input.type }, 'Failed to record activity');
  }
}
