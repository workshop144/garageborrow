// GB-R1-1: a member's display_name is shown to every member of each garage, so
// PATCH /v1/me bounds it (1 to 60 characters after trimming, no control or bidi
// override characters) like every other member-writable text field.

import { tenantUserKey } from "@garageborrow/shared";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import { FAMILY_PHONE, GARAGE_ID, seedGarage, seedMembership, seedUser } from "./_fixtures.js";
import { authHeader, installDdbMock, installFakeAuth, listAll, resetDdbStore } from "./_setup.js";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
  seedGarage();
  seedUser(FAMILY_PHONE, { display_name: "Original" });
  seedMembership(FAMILY_PHONE, "family");
});

function patchName(display_name: unknown): Promise<Response> {
  return Promise.resolve(
    createApp().request("/v1/me", {
      method: "PATCH",
      headers: { ...authHeader(FAMILY_PHONE), "content-type": "application/json" },
      body: JSON.stringify({ display_name }),
    }),
  );
}

function storedName(): unknown {
  const k = tenantUserKey(GARAGE_ID, FAMILY_PHONE);
  return listAll().find((r) => r.PK === k.pk && r.SK === k.sk)?.["display_name"];
}

describe("PATCH /v1/me display_name bounds", () => {
  it("accepts a 60-character name", async () => {
    const res = await patchName("a".repeat(60));
    expect(res.status).toBe(200);
    expect(storedName()).toBe("a".repeat(60));
  });

  it("rejects a 61-character name with 400 and stores nothing", async () => {
    const res = await patchName("a".repeat(61));
    expect(res.status).toBe(400);
    expect(storedName()).toBe("Original");
  });

  it("rejects a huge name with 400", async () => {
    const res = await patchName("x".repeat(390_000));
    expect(res.status).toBe(400);
    expect(storedName()).toBe("Original");
  });

  it("trims surrounding whitespace before storing", async () => {
    const res = await patchName("  Sam  ");
    expect(res.status).toBe(200);
    expect(storedName()).toBe("Sam");
  });

  it("rejects a whitespace-only name", async () => {
    expect((await patchName("    ")).status).toBe(400);
    expect(storedName()).toBe("Original");
  });

  it.each([
    ["newline", "Sam\nAdmin"],
    ["NUL", "Sam\u0000"],
    ["DEL", "Sam\u007f"],
    ["right-to-left override", "Sam‮redwo"],
    ["first strong isolate", "⁨Sam"],
  ])("rejects a name with a %s", async (_label, name) => {
    expect((await patchName(name)).status).toBe(400);
    expect(storedName()).toBe("Original");
  });

  it("keeps emoji sequences that use a zero-width joiner", async () => {
    const family = "Sam \u{1F468}‍\u{1F469}‍\u{1F467}";
    const res = await patchName(family);
    expect(res.status).toBe(200);
    expect(storedName()).toBe(family);
  });
});
