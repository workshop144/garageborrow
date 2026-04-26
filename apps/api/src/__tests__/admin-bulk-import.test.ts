import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import { GARAGE_ID, OWNER_PHONE, seedGarage, seedUser } from "./_fixtures.js";
import { authHeader, installDdbMock, installFakeAuth, listAll, resetDdbStore } from "./_setup.js";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
});

describe("POST /admin/items/bulk", () => {
  it("creates valid rows and surfaces per-row errors for invalid ones", async () => {
    seedGarage();
    seedUser(OWNER_PHONE);

    const app = createApp();
    const rows = [
      { name: "Drill", category: "power-tools", default_duration_days: "5" },
      { name: "Saw", category: "hand-tools", tags: ["sharp", "cutting"] },
      { name: "", category: "broken-row" },
      { category: "missing-name" },
    ];
    const res = await app.request(`/v1/g/${GARAGE_ID}/admin/items/bulk`, {
      method: "POST",
      headers: {
        ...authHeader(OWNER_PHONE),
        "content-type": "application/json",
        "Idempotency-Key": "bulk-1",
      },
      body: JSON.stringify({ rows }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      created: number;
      errors: number;
      results: Array<{ status: "ok" | "error"; index: number }>;
    };
    expect(body.total).toBe(4);
    expect(body.created).toBe(2);
    expect(body.errors).toBe(2);
    expect(body.results[0]?.status).toBe("ok");
    expect(body.results[1]?.status).toBe("ok");
    expect(body.results[2]?.status).toBe("error");
    expect(body.results[3]?.status).toBe("error");

    const itemRecords = listAll().filter(
      (it) => typeof it["SK"] === "string" && (it["SK"] as string).startsWith("ITEM#"),
    );
    expect(itemRecords.length).toBe(2);
  });

  it("rejects non-owner callers with 403", async () => {
    seedGarage();
    seedUser(OWNER_PHONE);

    const app = createApp();
    const res = await app.request(`/v1/g/${GARAGE_ID}/admin/items/bulk`, {
      method: "POST",
      headers: {
        ...authHeader("+15555550999"),
        "content-type": "application/json",
        "Idempotency-Key": "bulk-2",
      },
      body: JSON.stringify({ rows: [{ name: "x", category: "y" }] }),
    });
    expect(res.status).toBe(403);
  });
});
