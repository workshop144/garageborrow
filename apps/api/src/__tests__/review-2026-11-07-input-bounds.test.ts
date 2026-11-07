// 2026-11-07 review, input bounds and response shapes: F7 (instance rows sent
// raw to members), F9 (unbounded default_duration_days), F10 (push endpoints
// with no host allowlist or per-user cap) and F13 (meRoutes' requireAuth ran
// for every route, so unknown paths were 401 instead of 404).

import { itemKey } from "@garageborrow/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deliverPush, setPushDriver } from "../lib/channels.js";
import { PUBLIC_ROUTES } from "../lib/public-routes.js";
import { isAllowedPushEndpoint, MAX_PUSH_SUBSCRIPTIONS } from "../lib/push-endpoint.js";
import { createApp } from "../index.js";
import {
  FAMILY_PHONE,
  GARAGE_ID,
  OWNER_PHONE,
  seedGarage,
  seedInstanceRecord,
  seedItemRecord,
  seedMembership,
  seedUser,
} from "./_fixtures.js";
import {
  authHeader,
  installDdbMock,
  installFakeAuth,
  listAll,
  resetDdbStore,
  seedItem,
} from "./_setup.js";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
  seedGarage();
  seedUser(OWNER_PHONE);
  seedUser(FAMILY_PHONE);
  seedMembership(FAMILY_PHONE, "family");
});

afterEach(() => {
  setPushDriver(undefined);
});

const json = (phone: string, extra: Record<string, string> = {}) => ({
  ...authHeader(phone),
  "content-type": "application/json",
  ...extra,
});

describe("F7: GET /items/:id sends members an instance allowlist", () => {
  it("drops owner notes, table keys and loan ids from each instance", async () => {
    seedItemRecord({ id: "drill" });
    seedInstanceRecord("drill", {
      id: "u1",
      label: "Blue",
      notes: "owner-private: battery swells",
      current_loan_id: "loan-x",
    });
    const res = await createApp().request(`/v1/g/${GARAGE_ID}/items/drill`, {
      headers: authHeader(FAMILY_PHONE),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as { instances: Record<string, unknown>[] };
    expect(body.instances).toEqual([
      { id: "u1", label: "Blue", quality_tier: "A", status: "available" },
    ]);
    expect(text).not.toContain("owner-private");
    expect(text).not.toMatch(/"(PK|SK)"/);
  });
});

describe("F9: default_duration_days is bounded", () => {
  it.each([61, 1e8])("POST /items refuses default_duration_days=%s", async (days) => {
    const res = await createApp().request(`/v1/g/${GARAGE_ID}/items`, {
      method: "POST",
      headers: json(OWNER_PHONE),
      body: JSON.stringify({
        name: "Ladder",
        description: "",
        category: "ladders",
        primary_photo_key: "uploads/tool_photo/a.jpg",
        default_duration_days: days,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /items/:id refuses 61 and keeps the stored value", async () => {
    seedItemRecord({ id: "drill", default_duration_days: 5 });
    const res = await createApp().request(`/v1/g/${GARAGE_ID}/items/drill`, {
      method: "PATCH",
      headers: json(OWNER_PHONE),
      body: JSON.stringify({ default_duration_days: 61 }),
    });
    expect(res.status).toBe(400);
    const k = itemKey(GARAGE_ID, "drill");
    expect(listAll().find((r) => r.PK === k.pk && r.SK === k.sk)?.["default_duration_days"]).toBe(
      5,
    );
  });

  it("bulk import reports a row over 60 days as an error", async () => {
    const res = await createApp().request(`/v1/g/${GARAGE_ID}/admin/items/bulk`, {
      method: "POST",
      headers: json(OWNER_PHONE, { "Idempotency-Key": "bulk-f9" }),
      body: JSON.stringify({
        rows: [
          { name: "Ok", category: "x", default_duration_days: "60" },
          { name: "Huge", category: "x", default_duration_days: "100000000" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      created: number;
      errors: number;
      results: { status: string }[];
    };
    expect(body.created).toBe(1);
    expect(body.errors).toBe(1);
    expect(body.results.map((r) => r.status)).toEqual(["ok", "error"]);
  });

  it("a legacy item with a huge default is clamped to 60 days, not a 500", async () => {
    seedItemRecord({ id: "old", default_duration_days: 100_000_000 });
    const before = Date.now();
    const res = await createApp().request(`/v1/g/${GARAGE_ID}/loans`, {
      method: "POST",
      headers: json(FAMILY_PHONE),
      body: JSON.stringify({ item_id: "old", liability_acknowledged: true }),
    });
    expect(res.status).toBe(201);
    const { loan } = (await res.json()) as { loan: { expected_return_at: string } };
    const days = (Date.parse(loan.expected_return_at) - before) / 86_400_000;
    expect(days).toBeGreaterThan(59.9);
    expect(days).toBeLessThanOrEqual(60.01);
  });
});

describe("F10: push subscriptions", () => {
  const sub = (endpoint: string) => ({
    endpoint,
    keys: { p256dh: "BNcR".padEnd(87, "a"), auth: "tBHI".padEnd(22, "b") },
  });
  const register = (endpoint: string) =>
    createApp().request("/v1/me/push-subscription", {
      method: "POST",
      headers: json(FAMILY_PHONE),
      body: JSON.stringify(sub(endpoint)),
    });
  const stored = () =>
    listAll().filter((r) => r.PK === `USER#${FAMILY_PHONE}` && String(r.SK).startsWith("PUSH#"));

  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QGx",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("accepts a browser push service: %s", async (endpoint) => {
    expect((await register(endpoint)).status).toBe(201);
    expect(stored()).toHaveLength(1);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://169.254.169.254/latest/meta-data/",
    "https://attacker.example/hook",
    "https://fcm.googleapis.com.attacker.example/x",
    "https://user:pw@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x",
    "https://notify.windows.com/x",
  ])("refuses %s with 400 and stores nothing", async (endpoint) => {
    expect((await register(endpoint)).status).toBe(400);
    expect(stored()).toHaveLength(0);
  });

  it("keeps at most MAX_PUSH_SUBSCRIPTIONS per member, dropping the oldest", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (let i = 0; i < MAX_PUSH_SUBSCRIPTIONS + 3; i++) {
        vi.setSystemTime(new Date(Date.UTC(2026, 10, 7, 12, i)));
        expect((await register(`https://fcm.googleapis.com/fcm/send/e${i}`)).status).toBe(201);
      }
    } finally {
      vi.useRealTimers();
    }
    const rows = stored();
    expect(rows).toHaveLength(MAX_PUSH_SUBSCRIPTIONS);
    const endpoints = rows.map((r) => r["endpoint"]);
    for (const old of [0, 1, 2]) {
      expect(endpoints).not.toContain(`https://fcm.googleapis.com/fcm/send/e${old}`);
    }
    expect(endpoints).toContain(
      `https://fcm.googleapis.com/fcm/send/e${MAX_PUSH_SUBSCRIPTIONS + 2}`,
    );
  });

  it("re-registering the same endpoint does not count twice", async () => {
    for (let i = 0; i < 3; i++) await register("https://fcm.googleapis.com/fcm/send/same");
    expect(stored()).toHaveLength(1);
  });

  function seedSub(endpoint: string, sk: string): void {
    seedItem({
      PK: `USER#${FAMILY_PHONE}`,
      SK: sk,
      user_phone: FAMILY_PHONE,
      endpoint,
      keys: { p256dh: "p", auth: "a" },
      created_at: "2026-11-01T00:00:00Z",
    });
  }
  const msg = {
    type: "loan_extended" as const,
    user_phone: FAMILY_PHONE,
    title: "t",
    body: "b",
    payload: {},
  };

  it("the notifier never posts to a stored endpoint outside the allowlist", async () => {
    seedSub("https://169.254.169.254/latest/meta-data/", "PUSH#legacy");
    seedSub("https://fcm.googleapis.com/fcm/send/ok", "PUSH#ok");
    const driver = vi.fn(() => Promise.resolve());
    setPushDriver(driver);
    expect(await deliverPush(msg)).toBe(1);
    expect(driver).toHaveBeenCalledTimes(1);
    expect((driver.mock.calls[0] as unknown[])[0]).toMatchObject({
      endpoint: "https://fcm.googleapis.com/fcm/send/ok",
    });
  });

  it("prunes a subscription the push service reports gone (404/410)", async () => {
    seedSub("https://fcm.googleapis.com/fcm/send/gone", "PUSH#gone");
    seedSub("https://fcm.googleapis.com/fcm/send/flaky", "PUSH#flaky");
    setPushDriver((s) =>
      Promise.reject(
        Object.assign(new Error("push failed"), {
          statusCode: s.endpoint.endsWith("gone") ? 410 : 500,
        }),
      ),
    );
    expect(await deliverPush(msg)).toBe(0);
    // A 500 is transient: that row stays.
    expect(stored().map((r) => r.SK)).toEqual(["PUSH#flaky"]);
  });

  it("isAllowedPushEndpoint rejects garbage", () => {
    expect(isAllowedPushEndpoint("not a url")).toBe(false);
    expect(isAllowedPushEndpoint("javascript:alert(1)")).toBe(false);
  });
});

describe("F13: auth is enforced per route, not by a catch-all", () => {
  const PUBLIC = new Set<string>(PUBLIC_ROUTES);

  it("an unknown path is a 404, not a 401", async () => {
    const res = await createApp().request("/v1/no-such-route");
    expect(res.status).toBe(404);
  });

  it("every registered route except the public ones answers 401 without a token", async () => {
    const app = createApp();
    const routes = new Map<string, { method: string; path: string }>();
    for (const r of app.routes) {
      if (r.method === "ALL") continue; // middleware
      routes.set(`${r.method} ${r.path}`, { method: r.method, path: r.path });
    }
    expect(routes.size).toBeGreaterThan(40);
    const open: string[] = [];
    for (const [id, { method, path }] of routes) {
      if (PUBLIC.has(id)) continue;
      const url = path.replace(/:[A-Za-z_]+/g, "x").replace(/\*/g, "x");
      const res = await app.request(url, {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "GET" || method === "HEAD" ? {} : { body: "{}" }),
      });
      if (res.status !== 401) open.push(`${id} -> ${res.status}`);
    }
    expect(open).toEqual([]);
  });

  it("the public routes are reachable without a token", async () => {
    const app = createApp();
    for (const path of ["/v1/health", "/v1/openapi.json", "/v1/docs"]) {
      expect((await app.request(path)).status, path).toBe(200);
    }
  });
});
