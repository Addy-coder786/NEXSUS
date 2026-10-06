import type { RequestHandler } from 'express';
import type { z } from 'zod';
import { fileListQuerySchema, hasPermission, uploadFileFieldsSchema, type Permission, type updateFileSchema } from '@nexus/shared';
import { getAuthUser, getMemberRole, getTaskContext, getWorkspaceContext } from '../../middleware/authorize';
import { typedQuery } from '../../middleware/validate';
import { ApiError } from '../../utils/ApiError';
import { asyncHandler } from '../../utils/asyncHandler';
import { created, noContent, ok } from '../../utils/response';
import * as fileService from './file.service';
import type { FileLean } from './file.service';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      storedFile?: FileLean;
    }
  }
}

type UpdateFileInput = z.infer<typeof updateFileSchema>;

function getFileContext(req: Parameters<RequestHandler>[0]): FileLean {
  if (!req.storedFile) throw ApiError.internal('File context missing');
  return req.storedFile;
}

/** Loads `/files/:id`, checks workspace membership + `permission` + project access. */
export function requireFilePermission(permission: Permission): RequestHandler {
  return async (req, _res, next) => {
    try {
      const user = getAuthUser(req);
      const file = await fileService.loadFileById(req.params.id ?? '');
      const workspaceId = String(file.workspaceId);
      const role = await getMemberRole(workspaceId, user.id);
      if (!role) throw ApiError.forbidden('You are not a member of this workspace');
      if (!hasPermission(role, permission)) throw ApiError.forbidden();
      await fileService.assertFileAccess(file, role, user.id);
      req.workspace = { id: workspaceId, role };
      req.storedFile = file;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// ---- /workspaces/:id/files ----

export const uploadFile = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  const file = req.file;
  if (!file) throw ApiError.badRequest('Missing "file" part');
  const fields = uploadFileFieldsSchema.parse(req.body ?? {});
  created(
    res,
    await fileService.uploadFile(
      ws.id,
      user.id,
      ws.role,
      { originalname: file.originalname, mimetype: file.mimetype, buffer: file.buffer, size: file.size },
      fields,
    ),
  );
});

export const listFiles = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  const query = typedQuery(req, fileListQuerySchema);
  const { items, meta } = await fileService.listFiles(ws.id, user.id, ws.role, query);
  ok(res, items, meta);
});

export const getUsage = asyncHandler(async (req, res) => {
  const ws = getWorkspaceContext(req);
  ok(res, await fileService.getUsage(ws.id));
});

// ---- /files/:id ----

export const getFile = asyncHandler(async (req, res) => {
  ok(res, await fileService.getFile(getFileContext(req)));
});

export const renameFile = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  const input: UpdateFileInput = req.body;
  ok(res, await fileService.renameFile(getFileContext(req), user.id, ws.role, input.name));
});

export const deleteFile = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  await fileService.deleteFile(getFileContext(req), user.id, ws.role);
  noContent(res);
});

// ---- /tasks/:id/files ----

export const listTaskFiles = asyncHandler(async (req, res) => {
  ok(res, await fileService.listTaskFiles(getTaskContext(req)._id));
});
