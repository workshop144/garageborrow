// Finding S5-2: member phones reached Sentry through the request path on
// admin member/invite errors. The error boundary must send a scrubbed path,
// and the Sentry hooks must scrub events and breadcrumbs.
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentryMock = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock("@sentry/aws-serverless", () => sentryMock);

import { ApiError } from "../lib/errors.js";
import { captureError, initSentry } from "../lib/sentry.js";
import type { AppEnv } from "../lib/types.js";
import { errorBoundary, onError } from "../middleware/error.js";

const PHONE = "+15555550123";
const DIGIT_RUN = /\d{6,}/;

function appThatThrows(err: unknown): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", errorBoundary());
  app.onError(onError);
  const fail = () => {
    throw err;
  };
  app.patch("/v1/g/:garage/admin/members/:phone", fail);
  app.delete("/v1/g/:garage/admin/invites/:phone", fail);
  return app;
}

describe("Sentry phone scrubbing (S5-2)", () => {
  beforeEach(() => {
    vi.stubEnv("SENTRY_DSN", "https://public@example.invalid/1");
    sentryMock.init.mockClear();
    sentryMock.captureException.mockClear();
    initSentry();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["PATCH", `/v1/g/g1/admin/members/${encodeURIComponent(PHONE)}`, new Error("throttled")],
    ["DELETE", `/v1/g/g1/admin/invites/${encodeURIComponent(PHONE)}`, new Error("boom")],
    ["PATCH", `/v1/g/g1/admin/members/${PHONE}`, new ApiError("internal_error", "ddb down")],
  ])("%s %s sends extras with no phone digit run", async (method, path, err) => {
    const res = await appThatThrows(err).request(path, { method });
    expect(res.status).toBe(500);
    expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
    const [, ctx] = sentryMock.captureException.mock.calls[0] as [unknown, { extra: unknown }];
    const extra = ctx.extra as { path: string; method: string };
    expect(JSON.stringify(extra)).not.toMatch(DIGIT_RUN);
    expect(extra.path).toMatch(/\/admin\/(members|invites)\/\[phone\]$/);
    expect(extra.method).toBe(method);
  });

  it("scrubs extras passed to captureError directly", () => {
    captureError(new Error("x"), { step: "notify", to: PHONE });
    const [, ctx] = sentryMock.captureException.mock.calls[0] as [unknown, { extra: unknown }];
    expect(JSON.stringify(ctx.extra)).not.toMatch(DIGIT_RUN);
  });

  it("registers beforeSend/beforeBreadcrumb hooks that scrub phones", async () => {
    vi.resetModules();
    const fresh = await import("../lib/sentry.js");
    fresh.initSentry();
    const opts = sentryMock.init.mock.calls.at(-1)?.[0] as {
      beforeSend: (e: unknown) => unknown;
      beforeBreadcrumb: (b: unknown) => unknown;
    };
    const event = {
      message: `PATCH /admin/members/${PHONE} failed`,
      request: { url: `https://api.example/v1/g/g1/admin/members/%2B15555550123` },
      extra: { path: `/v1/g/g1/admin/invites/${PHONE}` },
      exception: { values: [{ value: `ConditionalCheckFailed for ${PHONE}` }] },
    };
    expect(JSON.stringify(opts.beforeSend(event))).not.toMatch(DIGIT_RUN);
    const crumb = { category: "http", data: { url: "/v1/g/g1/admin/invites/%2B15555550123" } };
    expect(JSON.stringify(opts.beforeBreadcrumb(crumb))).not.toMatch(DIGIT_RUN);
  });
});
