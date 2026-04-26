const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/v1";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;
  constructor(opts: { code: string; message: string; status: number; details?: unknown }) {
    super(opts.message);
    this.name = "ApiError";
    this.code = opts.code;
    this.status = opts.status;
    this.details = opts.details;
  }
}

type ErrorEnvelope = {
  error?: { code?: string; message?: string; details?: unknown };
};

export type RequestOpts = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  idempotencyKey?: string;
};

let tokenProvider: () => string | null = () => null;

export function setAuthTokenProvider(fn: () => string | null): void {
  tokenProvider = fn;
}

export async function apiRequest<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts.headers ?? {}),
  };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (opts.idempotencyKey) {
    headers["Idempotency-Key"] = opts.idempotencyKey;
  }
  const token = tokenProvider();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers,
  };
  if (opts.signal) {
    init.signal = opts.signal;
  }
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, init);

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  const parsed: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const env = (parsed ?? {}) as ErrorEnvelope;
    throw new ApiError({
      code: env.error?.code ?? `HTTP_${res.status}`,
      message: env.error?.message ?? res.statusText ?? "Request failed",
      status: res.status,
      details: env.error?.details,
    });
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOpts, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "GET" }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOpts, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOpts, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "PATCH", body }),
  delete: <T>(path: string, opts?: Omit<RequestOpts, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "DELETE" }),
};
