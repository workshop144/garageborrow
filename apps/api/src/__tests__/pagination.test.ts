import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor, paginate, parsePageParams } from "../lib/pagination.js";
import { ApiError } from "../lib/errors.js";

describe("pagination cursor", () => {
  it("encode → decode round-trip", () => {
    for (const n of [0, 1, 50, 999, 1_000_000]) {
      const c = encodeCursor(n);
      expect(decodeCursor(c)).toBe(n);
    }
  });

  it("rejects malformed cursors", () => {
    expect(() => decodeCursor("not-base64!!!")).toThrow(ApiError);
    expect(() => decodeCursor(Buffer.from("garbage", "utf8").toString("base64url"))).toThrow(
      ApiError,
    );
    expect(() =>
      decodeCursor(Buffer.from(JSON.stringify({ o: -1 }), "utf8").toString("base64url")),
    ).toThrow(ApiError);
    expect(() =>
      decodeCursor(Buffer.from(JSON.stringify({ x: 1 }), "utf8").toString("base64url")),
    ).toThrow(ApiError);
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 10 }, (_, i) => i);

  it("returns first page and next_cursor when more remain", () => {
    const { page, next_cursor } = paginate(items, { limit: 3, offset: 0 });
    expect(page).toEqual([0, 1, 2]);
    expect(next_cursor).toBeTypeOf("string");
    expect(decodeCursor(next_cursor!)).toBe(3);
  });

  it("omits next_cursor on the last page", () => {
    const { page, next_cursor } = paginate(items, { limit: 5, offset: 5 });
    expect(page).toEqual([5, 6, 7, 8, 9]);
    expect(next_cursor).toBeUndefined();
  });
});

describe("parsePageParams", () => {
  function fakeCtx(query: Record<string, string>): {
    req: { query: (key: string) => string | undefined };
  } {
    return { req: { query: (k: string) => query[k] } };
  }

  it("uses defaults when no params", () => {
    const params = parsePageParams(fakeCtx({}) as never);
    expect(params).toEqual({ limit: 50, offset: 0 });
  });

  it("rejects out-of-range limit", () => {
    expect(() => parsePageParams(fakeCtx({ limit: "0" }) as never)).toThrow(ApiError);
    expect(() => parsePageParams(fakeCtx({ limit: "101" }) as never)).toThrow(ApiError);
    expect(() => parsePageParams(fakeCtx({ limit: "1.5" }) as never)).toThrow(ApiError);
  });

  it("decodes a valid cursor", () => {
    const cursor = encodeCursor(20);
    const params = parsePageParams(fakeCtx({ cursor, limit: "10" }) as never);
    expect(params).toEqual({ limit: 10, offset: 20 });
  });
});
