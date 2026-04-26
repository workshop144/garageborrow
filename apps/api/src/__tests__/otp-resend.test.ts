import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../index.js";
import { setOtpResendTrigger } from "../lib/cognito.js";
import { installDdbMock, resetDdbStore } from "./_setup.js";

let triggered: string[] = [];

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
  triggered = [];
  setOtpResendTrigger((phone) => {
    triggered.push(phone);
    return Promise.resolve();
  });
});

afterEach(() => {
  setOtpResendTrigger(undefined);
});

describe("POST /v1/auth/resend-otp", () => {
  it("triggers cognito and returns retry_after on first call", async () => {
    const app = createApp();
    const res = await app.request("/v1/auth/resend-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+13175550123" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; retry_after_seconds: number };
    expect(body.status).toBe("sent");
    expect(body.retry_after_seconds).toBe(60);
    expect(triggered).toEqual(["+13175550123"]);
  });

  it("rate-limits the second call to 429 with retry_after_seconds", async () => {
    const app = createApp();
    const phone = "+13175550124";
    const first = await app.request("/v1/auth/resend-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    expect(first.status).toBe(200);
    const second = await app.request("/v1/auth/resend-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    expect(second.status).toBe(429);
    const body = (await second.json()) as {
      error: { code: string; details?: { retry_after_seconds: number } };
    };
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.details?.retry_after_seconds).toBeGreaterThan(0);
    expect(body.error.details?.retry_after_seconds).toBeLessThanOrEqual(60);
    expect(triggered).toEqual([phone]); // cognito only called once
  });

  it("rejects invalid phone with 400", async () => {
    const app = createApp();
    const res = await app.request("/v1/auth/resend-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "not-a-phone" }),
    });
    expect(res.status).toBe(400);
  });

  it("does not require a JWT", async () => {
    const app = createApp();
    const res = await app.request("/v1/auth/resend-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "+13175550199" }),
    });
    expect(res.status).toBe(200);
  });
});
