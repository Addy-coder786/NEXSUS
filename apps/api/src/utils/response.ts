import type { Response } from 'express';
import type { ApiSuccess, PaginationMeta } from '@nexus/shared';

export function ok<T>(res: Response, data: T, meta?: PaginationMeta, status = 200) {
  const body: ApiSuccess<T> = meta ? { success: true, data, meta } : { success: true, data };
  return res.status(status).json(body);
}

export function created<T>(res: Response, data: T) {
  return ok(res, data, undefined, 201);
}

export function noContent(res: Response) {
  return res.status(204).end();
}

export function paginationMeta(page: number, limit: number, total: number): PaginationMeta {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
