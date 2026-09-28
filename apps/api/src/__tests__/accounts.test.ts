// Invite-only account creation: owner invites -> /v1/auth/start creates the
// Cognito user for invited (or already-profiled) phones only, rate-limited ->
// /v1/me/join turns the invite into a membership. Plus the IAM/env the template
// must carry for it (the trigger's SMS caps are tested with the trigger).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import { setEnsureCognitoUser } from "../lib/cognito.js";
import { GARAGE_ID, OWNER_PHONE, seedGarage, seedMembership, seedUser } from "./_fixtures.js";
import {
  authHeader,
  installDdbMock,
  installFakeAuth,
  listAll,
  resetDdbStore,
  seedItem,
} from "./_setup.js";

const NEW_PHONE = "+13175550140";
let ensured: string[] = [];

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
  ensured = [];
  setEnsureCognitoUser((phone) => {
    ensured.push(phone);
    return Promise.resolve(true);
  });
});

afterEach(() => {
  setEnsureCognitoUser(undefined);
});

function start(phone: string, ip = "198.51.100.7") {
  const app = createApp();
  return app.request(
    "/v1/auth/start",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone }),
    },
    { requestContext: { http: { sourceIp: ip } } },
  );
}

async function invite(phone: string, tier = "friend") {
  const app = createApp();
  return app.request(`/v1/g/${GARAGE_ID}/admin/invites`, {
    method: "POST",
    headers: { ...authHeader(OWNER_PHONE), "content-type": "application/json" },
    body: JSON.stringify({ phone, tier }),
  });
}

describe("POST /v1/g/:garage/admin/invites", () => {
  it("lets the owner invite a number; a member can't", async () => {
    seedGarage();
    seedUser(OWNER_PHONE);
    const res = await invite(NEW_PHONE);
    expect(res.status).toBe(201);
    const inv = listAll().find((i) => i.PK === `INVITE#${NEW_PHONE}`);
    expect(inv).toMatchObject({
      garage_id: GARAGE_ID,
      tier: "friend",
      invited_by_phone: OWNER_PHONE,
    });
    expect(inv?.["GSI1PK"]).toBe(`INVITES#${GARAGE_ID}`);

    seedMembership("+15555550300", "family");
    const app = createApp();
    const denied = await app.request(`/v1/g/${GARAGE_ID}/admin/invites`, {
      method: "POST",
      headers: { ...authHeader("+15555550300"), "content-type": "application/json" },
      body: JSON.stringify({ phone: "+13175550141" }),
    });
    expect(denied.status).toBe(403);
  });

  it("refuses to invite an existing member, and lists and revokes invites", async () => {
    seedGarage();
    seedMembership("+15555550300", "howdy");
    expect((await invite("+15555550300")).status).toBe(409);

    await invite(NEW_PHONE);
    const app = createApp();
    const list = await app.request(`/v1/g/${GARAGE_ID}/admin/invites`, {
      headers: authHeader(OWNER_PHONE),
    });
    const body = (await list.json()) as { invites: Array<{ phone: string }> };
    expect(body.invites.map((i) => i.phone)).toEqual([NEW_PHONE]);

    const del = await app.request(
      `/v1/g/${GARAGE_ID}/admin/invites/${encodeURIComponent(NEW_PHONE)}`,
      { method: "DELETE", headers: authHeader(OWNER_PHONE) },
    );
    expect(del.status).toBe(200);
    expect(listAll().some((i) => i.PK === `INVITE#${NEW_PHONE}`)).toBe(false);
  });
});

describe("POST /v1/auth/start", () => {
  it("creates no account for an uninvited number, with the same response", async () => {
    const res = await start(NEW_PHONE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", retry_after_seconds: 60 });
    expect(ensured).toEqual([]);
  });

  it("creates the account for an invited number", async () => {
    seedGarage();
    await invite(NEW_PHONE);
    const res = await start(NEW_PHONE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", retry_after_seconds: 60 });
    expect(ensured).toEqual([NEW_PHONE]);
  });

  it("ensures the account for an existing profile (the seeded owner)", async () => {
    seedGarage();
    seedUser(OWNER_PHONE);
    await start(OWNER_PHONE);
    expect(ensured).toEqual([OWNER_PHONE]);
  });

  it("does nothing for an account scheduled for deletion", async () => {
    seedGarage();
    seedUser(NEW_PHONE, { deleted_at: "2026-09-01T00:00:00Z" });
    await start(NEW_PHONE);
    expect(ensured).toEqual([]);
  });

  it("allows one start per phone per minute", async () => {
    expect((await start(NEW_PHONE)).status).toBe(200);
    const again = await start(NEW_PHONE);
    expect(again.status).toBe(429);
  });

  it("caps starts per client IP per hour", async () => {
    for (let i = 0; i < 20; i++) {
      expect((await start(`+1317555${String(1000 + i)}`)).status).toBe(200);
    }
    expect((await start("+13175552000")).status).toBe(429);
    // Another address is unaffected.
    expect((await start("+13175552001", "198.51.100.8")).status).toBe(200);
  });

  it("rejects a malformed phone", async () => {
    expect((await start("not-a-phone")).status).toBe(400);
  });
});

describe("POST /v1/me/join", () => {
  it("turns an invite into a membership and profile, once", async () => {
    seedGarage();
    await invite(NEW_PHONE, "friend");
    const app = createApp();
    const res = await app.request("/v1/me/join", {
      method: "POST",
      headers: authHeader(NEW_PHONE),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ joined: [GARAGE_ID] });

    const items = listAll();
    const member = items.find((i) => i.SK === `MEMBER#${NEW_PHONE}`);
    expect(member).toMatchObject({ tier: "friend", vouched_by_phone: OWNER_PHONE });
    const profile = items.find((i) => i.SK === `USER#${NEW_PHONE}`);
    expect(profile).toMatchObject({
      GSI1PK: `USER#${NEW_PHONE}`,
      GSI1SK: `USER#${GARAGE_ID}`,
      garages_member_of: [GARAGE_ID],
    });
    expect(items.some((i) => i.PK === `INVITE#${NEW_PHONE}`)).toBe(false);

    const me = await app.request("/v1/me", { headers: authHeader(NEW_PHONE) });
    expect(me.status).toBe(200);
    const second = await app.request("/v1/me/join", {
      method: "POST",
      headers: authHeader(NEW_PHONE),
    });
    expect(await second.json()).toEqual({ joined: [] });
  });

  it("joins nothing without an invite", async () => {
    seedGarage();
    const app = createApp();
    const res = await app.request("/v1/me/join", {
      method: "POST",
      headers: authHeader(NEW_PHONE),
    });
    expect(await res.json()).toEqual({ joined: [] });
    expect(listAll().some((i) => i.SK === `MEMBER#${NEW_PHONE}`)).toBe(false);
  });
});

describe("GET /v1/me profile lookup", () => {
  it("finds the profile even when a loan row on the same index comes first", async () => {
    // A loan shares GSI1PK "USER#<phone>" and sorts before "USER#..."; seeded first,
    // an unfiltered Limit 1 query returns it instead of the profile.
    seedItem({
      PK: `TENANT#${GARAGE_ID}`,
      SK: "LOAN#2026-09-01#L1",
      GSI1PK: `USER#${NEW_PHONE}`,
      GSI1SK: "LOAN#2026-09-01",
    });
    seedGarage();
    seedUser(NEW_PHONE);
    const app = createApp();
    const res = await app.request("/v1/me", { headers: authHeader(NEW_PHONE) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { phone: string } };
    expect(body.user.phone).toBe(NEW_PHONE);
  });
});

describe("template: invite-only accounts", () => {
  const tpl = readFileSync(
    join(__dirname, "..", "..", "..", "..", "infra", "template.yaml"),
    "utf8",
  );

  it("lets the API create users and drops the unused SES grant", () => {
    expect(tpl).toMatch(/cognito-idp:AdminCreateUser\b/);
    expect(tpl).toMatch(/cognito-idp:AdminSetUserPassword\b/);
    expect(tpl).not.toMatch(/ses:SendEmail/);
  });

  it("keeps self-service SignUp closed", () => {
    expect(tpl).toMatch(/AllowAdminCreateUserOnly:\s*true/);
  });

  it("leaves Cognito no SMS path of its own that would skip the trigger's caps", () => {
    // ForgotPassword and attribute verification text through Cognito's own SMS
    // role, outside create-auth-challenge's per-phone and daily caps.
    expect(tpl).toMatch(/RecoveryMechanisms:\s*\n\s*- Name: admin_only/);
    expect(tpl).not.toMatch(/verified_phone_number/);
    expect(tpl).not.toMatch(/SmsConfiguration:/);
    expect(tpl).not.toMatch(/AutoVerifiedAttributes:/);
  });

  it("gives the create-auth trigger the table for its SMS caps", () => {
    const block = tpl.slice(
      tpl.indexOf("CreateAuthChallengeFunction:"),
      tpl.indexOf("CreateAuthChallengeInvokePermission:"),
    );
    expect(block).toMatch(/TABLE_NAME:\s*!Ref GarageBorrowTable/);
    expect(block).toMatch(/SMS_DAILY_CAP:\s*!Ref SmsDailyCap/);
    expect(block).toMatch(/dynamodb:UpdateItem/);
  });
});
