/** An error with a stable problem `type` (docs/02 common rules) and an HTTP status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    message?: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message ?? type);
  }
}

export const conflict = (type: string, message?: string, extra?: Record<string, unknown>) => new ApiError(409, type, message, extra);
export const unprocessable = (type: string, message?: string, extra?: Record<string, unknown>) => new ApiError(422, type, message, extra);
export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} not found`);
export const forbidden = (type = 'forbidden', message?: string) => new ApiError(403, type, message);
export const unauthorized = (type = 'unauthorized', message?: string) => new ApiError(401, type, message);
export const badRequest = (message: string, extra?: Record<string, unknown>) => new ApiError(400, 'bad_request', message, extra);
/** 429 with a Retry-After header (whole seconds, at least 1); the body carries retry_after_s too. */
export const tooManyRequests = (type: string, message: string, retryAfterMs: number) =>
  new ApiError(429, type, message, { retry_after_s: Math.max(1, Math.ceil(retryAfterMs / 1000)) });
