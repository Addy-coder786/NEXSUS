import type {
  ChangePasswordInput,
  UpdatePreferencesInput,
  UpdateProfileInput,
  UserPublicDto,
} from '@nexus/shared';
import { Session } from '../../models/Session';
import { User, type UserDocument } from '../../models/User';
import { WorkspaceMember } from '../../models/WorkspaceMember';
import { sendEmail } from '../../services/email';
import { deleteByUrl, uploadImage } from '../../services/storage';
import { ApiError } from '../../utils/ApiError';
import { passwordChangedEmail } from '../auth/auth.emails';
import { findActiveUserById, issueTokens, type IssuedTokens } from '../auth/auth.service';

export const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

async function requireUser(id: string): Promise<UserDocument> {
  const user = await findActiveUserById(id);
  if (!user) throw ApiError.notFound('User');
  return user;
}

export async function getMe(userId: string): Promise<UserDocument> {
  return requireUser(userId);
}

/** Empty strings clear optional text fields; `undefined` leaves a field untouched. */
function textOrNull(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value.length === 0 ? null : value;
}

export async function updateProfile(userId: string, input: UpdateProfileInput): Promise<UserDocument> {
  const user = await requireUser(userId);
  if (input.name !== undefined) user.name = input.name;
  if (input.availability !== undefined) user.availability = input.availability;

  const bio = textOrNull(input.bio);
  if (bio !== undefined) user.bio = bio;
  const title = textOrNull(input.title);
  if (title !== undefined) user.title = title;
  const timezone = textOrNull(input.timezone);
  if (timezone !== undefined) user.timezone = timezone;

  await user.save();
  return user;
}

export async function updatePreferences(
  userId: string,
  input: UpdatePreferencesInput,
): Promise<UserDocument> {
  const user = await requireUser(userId);
  if (input.theme !== undefined) user.preferences.theme = input.theme;
  if (input.notifications) {
    for (const [key, value] of Object.entries(input.notifications)) {
      if (typeof value === 'boolean') user.set(`preferences.notifications.${key}`, value);
    }
  }
  await user.save();
  return user;
}

/**
 * Changes the password, invalidates every *other* session and returns fresh tokens for the
 * current one so the caller stays signed in despite the tokenVersion bump.
 */
export async function changePassword(
  userId: string,
  sessionId: string,
  input: ChangePasswordInput,
): Promise<IssuedTokens | null> {
  const user = await requireUser(userId);
  if (!user.passwordHash) {
    throw ApiError.badRequest('This account has no password yet. Use "Forgot password" to set one.');
  }
  const valid = await user.comparePassword(input.currentPassword);
  if (!valid) throw ApiError.unauthorized('Current password is incorrect');

  await user.setPassword(input.newPassword);
  user.tokenVersion += 1;

  const current = await Session.findOne({ _id: sessionId, userId: user._id });
  const tokens = current ? issueTokens(user, current) : null;

  await Promise.all([
    user.save(),
    current?.save(),
    Session.deleteMany({ userId: user._id, _id: { $ne: sessionId } }),
  ]);
  await sendEmail(passwordChangedEmail(user.email, user.name));
  return tokens;
}

export async function uploadAvatar(userId: string, file: UploadedFile): Promise<UserDocument> {
  const user = await requireUser(userId);
  const previous = user.avatarUrl;

  // Timestamped id so a replaced avatar gets a new URL (no stale browser caches).
  const { url } = await uploadImage(file.buffer, {
    folder: 'avatars',
    publicId: `${String(user._id)}-${Date.now()}`,
    mimeType: file.mimetype,
  });
  user.avatarUrl = url;
  await user.save();

  if (previous && previous !== url) await deleteByUrl(previous);
  return user;
}

export async function deleteAvatar(userId: string): Promise<UserDocument> {
  const user = await requireUser(userId);
  const previous = user.avatarUrl;
  user.avatarUrl = null;
  await user.save();
  if (previous) await deleteByUrl(previous);
  return user;
}

/**
 * Public profile of another user. Only visible when the caller shares at least one workspace
 * with them; otherwise 404 (not 403) so the endpoint cannot be used to enumerate accounts.
 */
export async function getPublicUser(id: string, callerId: string): Promise<UserPublicDto> {
  const user = await User.findOne({ _id: id, deletedAt: null });
  if (!user) throw ApiError.notFound('User');

  if (id !== callerId) {
    const callerWorkspaces = await WorkspaceMember.distinct('workspaceId', { userId: callerId });
    const shared = await WorkspaceMember.exists({
      userId: id,
      workspaceId: { $in: callerWorkspaces },
    });
    if (!shared) throw ApiError.notFound('User');
  }
  return user.toPublicDto();
}
