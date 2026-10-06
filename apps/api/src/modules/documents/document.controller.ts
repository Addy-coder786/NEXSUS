import type { RequestHandler } from 'express';
import { z } from 'zod';
import {
  documentListQuerySchema,
  hasPermission,
  objectIdSchema,
  type CreateDocumentInput,
  type Permission,
  type UpdateDocumentInput,
} from '@nexus/shared';
import { getAuthUser, getMemberRole, getWorkspaceContext } from '../../middleware/authorize';
import { typedQuery } from '../../middleware/validate';
import { ApiError } from '../../utils/ApiError';
import { asyncHandler } from '../../utils/asyncHandler';
import { created, noContent, ok } from '../../utils/response';
import * as documentService from './document.service';
import type { DocumentLean } from './document.service';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      document?: DocumentLean;
    }
  }
}

export const versionParamsSchema = z.object({ id: objectIdSchema, version: z.coerce.number().int().min(1) });

function getDocumentContext(req: Parameters<RequestHandler>[0]): DocumentLean {
  if (!req.document) throw ApiError.internal('Document context missing');
  return req.document;
}

/**
 * Loads `/documents/:id`, resolves the caller's workspace role, checks `permission` and project
 * access, and attaches `req.document` + `req.workspace`.
 */
export function requireDocumentPermission(permission: Permission): RequestHandler {
  return async (req, _res, next) => {
    try {
      const user = getAuthUser(req);
      const doc = await documentService.loadDocumentById(req.params.id ?? '');
      const workspaceId = String(doc.workspaceId);
      const role = await getMemberRole(workspaceId, user.id);
      if (!role) throw ApiError.forbidden('You are not a member of this workspace');
      if (!hasPermission(role, permission)) throw ApiError.forbidden();
      await documentService.assertDocumentAccess(doc, role, user.id);
      req.workspace = { id: workspaceId, role };
      req.document = doc;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// ---- /workspaces/:id/documents ----

export const listDocuments = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  const query = typedQuery(req, documentListQuerySchema);
  const { items, meta } = await documentService.listDocuments(ws.id, user.id, ws.role, query);
  ok(res, items, meta);
});

export const createDocument = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  const input: CreateDocumentInput = req.body;
  created(res, await documentService.createDocument(ws.id, user.id, ws.role, input));
});

// ---- /documents/:id ----

export const getDocument = asyncHandler(async (req, res) => {
  ok(res, await documentService.buildDocumentDto(getDocumentContext(req)));
});

export const updateDocument = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const input: UpdateDocumentInput = req.body;
  ok(res, await documentService.updateDocument(getDocumentContext(req), user.id, input));
});

export const deleteDocument = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  await documentService.deleteDocument(getDocumentContext(req), user.id, ws.role);
  noContent(res);
});

export const listVersions = asyncHandler(async (req, res) => {
  ok(res, await documentService.listVersions(getDocumentContext(req)));
});

export const getVersion = asyncHandler(async (req, res) => {
  const { version } = versionParamsSchema.parse(req.params);
  ok(res, await documentService.getVersion(getDocumentContext(req), version));
});

export const restoreVersion = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const { version } = versionParamsSchema.parse(req.params);
  ok(res, await documentService.restoreVersion(getDocumentContext(req), version, user.id));
});

export const duplicateDocument = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  created(res, await documentService.duplicateDocument(getDocumentContext(req), user.id));
});
