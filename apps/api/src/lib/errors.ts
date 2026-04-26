export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "internal_error";

const HTTP_STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal_error: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown | undefined;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = HTTP_STATUS[code];
    this.details = details;
    this.name = "ApiError";
  }
}

export interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

export function toEnvelope(err: ApiError): ErrorEnvelope {
  const out: ErrorEnvelope = { error: { code: err.code, message: err.message } };
  if (err.details !== undefined) out.error.details = err.details;
  return out;
}
