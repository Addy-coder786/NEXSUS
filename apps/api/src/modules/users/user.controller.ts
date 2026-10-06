import type { Request } from 'express';
import type { ChangePasswordInput, UpdatePreferencesInput, UpdateProfileInput } from '@nexus/shared';
import type { AuthUser } from '../../middleware/authenticate';
import { ApiError } from '../../utils/ApiError';
import { asyncHandler } from '../../utils/asyncHandler';
import { setAuthCookies } from '../../utils/cookies';
import { noContent, ok } from '../../utils/response';
import * as userService from './user.service';

function requireUser(req: Request): AuthUser {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

/** Rejects files whose bytes do not match the declared image type. */
function looksLikeImage(buffer: Buffer, mimetype: string): boolean {
  if (mimetype === 'image/png') {
    return buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimetype === 'image/jpeg') {
    return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimetype === 'image/webp') {
    return buffer.length > 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

export const getMe = asyncHandler(async (req, res) => {
  const user = await userService.getMe(requireUser(req).id);
  ok(res, user.toDto());
});

export const updateProfile = asyncHandler(async (req, res) => {
  const user = await userService.updateProfile(requireUser(req).id, req.body as UpdateProfileInput);
  ok(res, user.toDto());
});

export const updatePreferences = asyncHandler(async (req, res) => {
  const user = await userService.updatePreferences(
    requireUser(req).id,
    req.body as UpdatePreferencesInput,
  );
  ok(res, user.toDto());
});

export const changePassword = asyncHandler(async (req, res) => {
  const auth = requireUser(req);
  const tokens = await userService.changePassword(auth.id, auth.sessionId, req.body as ChangePasswordInput);
  if (tokens) setAuthCookies(res, tokens.accessToken, tokens.refreshToken, tokens.refreshTtlSec);
  noContent(res);
});

export const uploadAvatar = asyncHandler(async (req, res) => {
  const file = req.file;
  if (!file) throw ApiError.badRequest('No file uploaded. Send the image as multipart field "file".');
  if (!looksLikeImage(file.buffer, file.mimetype)) {
    throw ApiError.badRequest('File content does not match a supported image type');
  }
  const user = await userService.uploadAvatar(requireUser(req).id, file);
  ok(res, user.toDto());
});

export const deleteAvatar = asyncHandler(async (req, res) => {
  const user = await userService.deleteAvatar(requireUser(req).id);
  ok(res, user.toDto());
});

export const getPublicUser = asyncHandler(async (req, res) => {
  const caller = requireUser(req);
  const { id } = req.params as { id: string };
  ok(res, await userService.getPublicUser(id, caller.id));
});
