import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import { MAX_UPLOAD_BYTES, MAX_UPLOADS_PER_DAY } from "../routes/uploads.js";
import { FAMILY_PHONE, seedGarage, seedUser } from "./_fixtures.js";
import { authHeader, installDdbMock, installFakeAuth, listAll, resetDdbStore } from "./_setup.js";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  installFakeAuth();
  process.env["AWS_ACCESS_KEY_ID"] ??= "test";
  process.env["AWS_SECRET_ACCESS_KEY"] ??= "test";
  process.env["AWS_REGION"] ??= "us-east-2";
});

async function sign(body: Record<string, unknown>, key: string) {
  seedGarage();
  seedUser(FAMILY_PHONE);
  const app = createApp();
  return app.request("/v1/uploads/sign", {
    method: "POST",
    headers: {
      ...authHeader(FAMILY_PHONE),
      "content-type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(body),
  });
}

describe("upload signing", () => {
  it("signs the declared size into the URL so S3 refuses any other body size", async () => {
    const res = await sign(
      { kind: "tool_photo", content_type: "image/jpeg", content_length: 2_000_000 },
      "k1",
    );
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    const signed = new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? "";
    expect(signed.split(";")).toContain("content-length");
  });

  it("signs If-None-Match so a URL cannot be replayed to overwrite its key", async () => {
    const res = await sign(
      { kind: "tool_photo", content_type: "image/png", content_length: 1_024 },
      "k-once",
    );
    expect(res.status).toBe(200);
    const { url, headers } = (await res.json()) as {
      url: string;
      headers: Record<string, string>;
    };
    const signed = new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? "";
    expect(signed.split(";")).toContain("if-none-match");
    expect(headers["If-None-Match"]).toBe("*");
  });

  it("refuses an upload over the cap, or one without a size", async () => {
    const tooBig = await sign(
      { kind: "tool_photo", content_type: "image/jpeg", content_length: MAX_UPLOAD_BYTES + 1 },
      "k2",
    );
    expect(tooBig.status).toBe(400);
    const noSize = await sign({ kind: "tool_photo", content_type: "image/jpeg" }, "k3");
    expect(noSize.status).toBe(400);
  });

  it("stops signing after the daily per-user quota", async () => {
    const photo = { kind: "tool_photo", content_type: "image/jpeg", content_length: 1_000 };
    for (let i = 0; i < MAX_UPLOADS_PER_DAY; i++) {
      const ok = await sign(photo, `q${i}`);
      expect(ok.status).toBe(200);
    }
    const over = await sign(photo, "q-over");
    expect(over.status).toBe(429);
  });

  it("keeps the uploader's phone number out of the object key", async () => {
    const res = await sign(
      { kind: "tool_photo", content_type: "image/jpeg", content_length: 1_000 },
      "k-no-phone",
    );
    expect(res.status).toBe(200);
    const { key, url } = (await res.json()) as { key: string; url: string };
    const digits = FAMILY_PHONE.replace("+", "");
    expect(key).toMatch(/^uploads\/tool_photo\/[^/]+\.jpeg$/);
    expect(key).not.toContain(digits);
    expect(decodeURIComponent(url)).not.toContain(digits);
  });

  it("expires the per-user quota counter instead of keeping the phone forever", async () => {
    await sign({ kind: "tool_photo", content_type: "image/jpeg", content_length: 1_000 }, "k-ttl");
    const counter = listAll().find((r) => r.PK === "RATELIMIT#upload-sign");
    expect(typeof counter?.["expires_at"]).toBe("number");
  });
});
