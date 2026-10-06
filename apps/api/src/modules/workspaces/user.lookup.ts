import type { Types } from 'mongoose';
import type { UserPublicDto } from '@nexus/shared';
import { USER_PUBLIC_FIELDS, User, toUserPublicDto } from '../../models/User';

export type UserRef = Types.ObjectId | string | null | undefined;

/** Placeholder for references to users that no longer exist. */
export function unknownUser(id: string): UserPublicDto {
  return { id, name: 'Unknown user', email: '', avatarUrl: null, title: null, availability: 'OFFLINE' };
}

/**
 * Batch-loads public DTOs for a set of user ids in one query. Unknown ids resolve to a
 * placeholder so DTO mappers never have to deal with missing users.
 */
export async function loadUserMap(refs: Iterable<UserRef>): Promise<UserMap> {
  const ids = new Set<string>();
  for (const ref of refs) if (ref) ids.add(String(ref));

  const map = new Map<string, UserPublicDto>();
  if (ids.size === 0) return new UserMap(map);

  const users = await User.find({ _id: { $in: [...ids] } })
    .select(USER_PUBLIC_FIELDS)
    .lean();
  for (const u of users) map.set(String(u._id), toUserPublicDto(u));
  return new UserMap(map);
}

export class UserMap {
  constructor(private readonly map: Map<string, UserPublicDto>) {}

  get(ref: Types.ObjectId | string): UserPublicDto {
    const id = String(ref);
    return this.map.get(id) ?? unknownUser(id);
  }

  getOrNull(ref: UserRef): UserPublicDto | null {
    return ref ? this.get(ref) : null;
  }
}

/** Convenience for a single reference. */
export async function loadUser(ref: Types.ObjectId | string): Promise<UserPublicDto> {
  const map = await loadUserMap([ref]);
  return map.get(ref);
}
