import { ERROR_CODES, type ErrorCode } from '@nexus/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message = 'Bad request', details?: unknown) {
    return new ApiError(400, ERROR_CODES.BAD_REQUEST, message, details);
  }
  static unauthorized(message = 'Authentication required', code: ErrorCode = ERROR_CODES.UNAUTHORIZED) {
    return new ApiError(401, code, message);
  }
  static forbidden(message = 'You do not have permission to perform this action') {
    return new ApiError(403, ERROR_CODES.FORBIDDEN, message);
  }
  static notFound(resource = 'Resource') {
    return new ApiError(404, ERROR_CODES.NOT_FOUND, `${resource} not found`);
  }
  static conflict(message: string) {
    return new ApiError(409, ERROR_CODES.CONFLICT, message);
  }
  static validation(details: unknown, message = 'Validation failed') {
    return new ApiError(422, ERROR_CODES.VALIDATION_ERROR, message, details);
  }
  static rateLimited(message = 'Too many requests, please try again later') {
    return new ApiError(429, ERROR_CODES.RATE_LIMITED, message);
  }
  static internal(message = 'Something went wrong') {
    return new ApiError(500, ERROR_CODES.INTERNAL, message);
  }
}
