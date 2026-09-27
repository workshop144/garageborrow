import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import { MAX_UPLOAD_BYTES } from "../routes/uploads.js";
import { FAMILY_PHONE, seedGarage, seedUser } from "./_fixtures.js";
import { authHeader, installDdbMock, installFakeAuth, resetDdbStore } from "./_setup.js";

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

  it("refuses an upload over the cap, or one without a size", async () => {
    const tooBig = await sign(
      { kind: "tool_photo", content_type: "image/jpeg", content_length: MAX_UPLOAD_BYTES + 1 },
      "k2",
    );
    expect(tooBig.status).toBe(400);
    const noSize = await sign({ kind: "tool_photo", content_type: "image/jpeg" }, "k3");
    expect(noSize.status).toBe(400);
  });
});
