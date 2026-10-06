import type { FilterQuery } from 'mongoose';
import type { ActivityDto, ActivityQuery, PaginationMeta, PaginationQuery } from '@nexus/shared';
import { Activity, toActivityDto, type IActivity } from '../../models/Activity';
import { WorkspaceMember } from '../../models/WorkspaceMember';
import { paginationMeta } from '../../utils/response';
import { loadUserMap } from '../workspaces/user.lookup';

export interface ActivityPage {
  items: ActivityDto[];
  meta: PaginationMeta;
}

/** Shared paginated listing used by the workspace, project and personal feeds. */
export async function listActivities(
  filter: FilterQuery<IActivity>,
  query: PaginationQuery & { type?: ActivityQuery['type'] },
): Promise<ActivityPage> {
  const { page, limit } = query;
  const match: FilterQuery<IActivity> = query.type ? { ...filter, type: query.type } : filter;

  const [total, activities] = await Promise.all([
    Activity.countDocuments(match),
    Activity.find(match)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  const users = await loadUserMap(activities.map((a) => a.actorId));
  return {
    items: activities.map((a) => toActivityDto(a, users.get(a.actorId))),
    meta: paginationMeta(page, limit, total),
  };
}

export function listWorkspaceActivities(workspaceId: string, query: ActivityQuery) {
  return listActivities({ workspaceId }, query);
}

export function listProjectActivities(
  workspaceId: string,
  projectId: string,
  query: ActivityQuery,
) {
  return listActivities({ workspaceId, projectId }, query);
}

/** Activities across every workspace the caller belongs to, newest first. */
export async function listMyActivities(
  userId: string,
  query: PaginationQuery,
): Promise<ActivityPage> {
  const memberships = await WorkspaceMember.find({ userId }).select('workspaceId').lean();
  const workspaceIds = memberships.map((m) => m.workspaceId);
  if (workspaceIds.length === 0) {
    return { items: [], meta: paginationMeta(query.page, query.limit, 0) };
  }
  return listActivities({ workspaceId: { $in: workspaceIds } }, query);
}
