import { afterEach, describe, expect, it, vi } from "vitest";

import { newIdempotencyKey } from "../idempotency";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe("newIdempotencyKey", () => {
  it("returns a fresh v4 UUID each call", () => {
    const a = newIdempotencyKey();
    expect(a).toMatch(UUID_V4);
    expect(newIdempotencyKey()).not.toBe(a);
  });

  it("falls back to a well-formed v4 UUID without crypto.randomUUID", () => {
    vi.stubGlobal("crypto", {});
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
    for (const k of keys) expect(k).toMatch(UUID_V4);
    expect(keys.size).toBe(50);
  });
});
