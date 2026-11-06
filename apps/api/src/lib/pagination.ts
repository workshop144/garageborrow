// Opaque base64url cursor pagination over arrays already loaded into memory.
//
// At MVP scale every list endpoint pulls all rows from a single DDB partition,
// then filters/sorts/enriches in memory before paginating. Encoding the offset
// into the cursor keeps client behavior identical to LEK-style pagination
// while letting us defer the GSI/OpenSearch upgrade until any garage exceeds
// ~200 items. If you migrate an endpoint to native DDB pagination, switch the
// cursor payload to LastEvaluatedKey-shaped JSON — clients already treat it
// as opaque.

import type { Context } from "hono";

import { ApiError } from "./errors.js";
import type { AppEnv } from "./types.js";

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

interface CursorPayload {
  o: number;
}

export interface PageParams {
  limit: number;
  offset: number;
}

function parseLimit(c: Context<AppEnv>): number {
  const limitRaw = c.req.query("limit");
  let limit = DEFAULT_PAGE_LIMIT;
  if (limitRaw !== undefined && limitRaw !== "") {
    const n = Number(limitRaw);
    if (!Number.isFinite(n) || n < 1 || n > MAX_PAGE_LIMIT || !Number.isInteger(n)) {
      throw new ApiError("bad_request", `limit must be an integer 1..${MAX_PAGE_LIMIT}`);
    }
    limit = n;
  }
  return limit;
}

export function parsePageParams(c: Context<AppEnv>): PageParams {
  const limit = parseLimit(c);
  const cursorRaw = c.req.query("cursor");
  let offset = 0;
  if (cursorRaw) {
    offset = decodeCursor(cursorRaw);
  }
  return { limit, offset };
}

export function decodeCursor(cursor: string): number {
  let json: string;
  try {
    json = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new ApiError("bad_request", "Invalid cursor");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ApiError("bad_request", "Invalid cursor");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as CursorPayload).o !== "number" ||
    !Number.isInteger((parsed as CursorPayload).o) ||
    (parsed as CursorPayload).o < 0
  ) {
    throw new ApiError("bad_request", "Invalid cursor");
  }
  return (parsed as CursorPayload).o;
}

export function encodeCursor(offset: number): string {
  const payload: CursorPayload = { o: offset };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export interface PageResult<T> {
  page: T[];
  next_cursor?: string;
}

export function paginate<T>(items: T[], { limit, offset }: PageParams): PageResult<T> {
  const slice = items.slice(offset, offset + limit);
  if (offset + limit < items.length) {
    return { page: slice, next_cursor: encodeCursor(offset + limit) };
  }
  return { page: slice };
}

// Keyset pagination for lists that shrink while being paged (a queue the
// caller works through): the cursor holds the sort key of the last row
// returned, and the next page starts strictly after it, so removing rows
// already seen does not skip any. `key` must be the list's sort order and
// unique per row (end it with the id).
export interface KeysetPageParams {
  limit: number;
  after?: string[];
}

export function parseKeysetPageParams(c: Context<AppEnv>): KeysetPageParams {
  const limit = parseLimit(c);
  const cursorRaw = c.req.query("cursor");
  if (!cursorRaw) return { limit };
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursorRaw, "base64url").toString("utf8"));
  } catch {
    throw new ApiError("bad_request", "Invalid cursor");
  }
  const after = (parsed as { k?: unknown } | null)?.k;
  if (!Array.isArray(after) || after.length === 0 || !after.every((x) => typeof x === "string")) {
    throw new ApiError("bad_request", "Invalid cursor");
  }
  return { limit, after: after as string[] };
}

function compareKeys(a: string[], b: string[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const c = (a[i] ?? "").localeCompare(b[i] ?? "");
    if (c !== 0) return c;
  }
  return 0;
}

export function paginateByKey<T>(
  sorted: T[],
  { limit, after }: KeysetPageParams,
  key: (row: T) => string[],
): PageResult<T> {
  const rest = after ? sorted.filter((r) => compareKeys(key(r), after) > 0) : sorted;
  const page = rest.slice(0, limit);
  const last = page[page.length - 1];
  if (rest.length > limit && last) {
    const next_cursor = Buffer.from(JSON.stringify({ k: key(last) }), "utf8").toString("base64url");
    return { page, next_cursor };
  }
  return { page };
}
