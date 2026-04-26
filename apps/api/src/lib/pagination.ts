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

export function parsePageParams(c: Context<AppEnv>): PageParams {
  const limitRaw = c.req.query("limit");
  const cursorRaw = c.req.query("cursor");
  let limit = DEFAULT_PAGE_LIMIT;
  if (limitRaw !== undefined && limitRaw !== "") {
    const n = Number(limitRaw);
    if (!Number.isFinite(n) || n < 1 || n > MAX_PAGE_LIMIT || !Number.isInteger(n)) {
      throw new ApiError("bad_request", `limit must be an integer 1..${MAX_PAGE_LIMIT}`);
    }
    limit = n;
  }
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
