// Finding S5-2: admin member/invite URLs carry the member's phone; the
// browser must not send it to Sentry in extras, events or breadcrumbs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentryMock = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock("@sentry/browser", () => sentryMock);

const DIGIT_RUN = /\d{6,}/;
const PHONE = "+15555550123";

describe("web Sentry phone scrubbing (S5-2)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.invalid/1");
    sentryMock.init.mockClear();
    sentryMock.captureException.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("api.ts reports a 5xx on an admin member URL without the phone", async () => {
    const { initSentry } = await import("../sentry");
    initSentry();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { code: "x" } }), { status: 503 })),
    );
    const { api } = await import("../api");
    await expect(
      api.patch(`/g/g1/admin/members/${encodeURIComponent(PHONE)}`, { tier: "friend" }),
    ).rejects.toMatchObject({ status: 503 });
    expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
    const [, ctx] = sentryMock.captureException.mock.calls[0] as [unknown, { extra: unknown }];
    expect(JSON.stringify(ctx.extra)).not.toMatch(DIGIT_RUN);
    expect((ctx.extra as { url: string }).url).toMatch(/\/admin\/members\/\[phone\]$/);
  });

  it("init registers beforeSend/beforeBreadcrumb hooks that scrub phones", async () => {
    const { initSentry } = await import("../sentry");
    initSentry();
    const opts = sentryMock.init.mock.calls.at(-1)?.[0] as {
      beforeSend: (e: unknown) => unknown;
      beforeBreadcrumb: (b: unknown) => unknown;
    };
    const event = {
      request: { url: "https://app.example/admin/members/%2B15555550123" },
      extra: { url: `/v1/g/g1/admin/invites/${encodeURIComponent(PHONE)}` },
    };
    expect(JSON.stringify(opts.beforeSend(event))).not.toMatch(DIGIT_RUN);
    const crumb = {
      category: "fetch",
      data: { method: "DELETE", url: "/v1/g/g1/admin/invites/%2B15555550123", status_code: 500 },
    };
    expect(JSON.stringify(opts.beforeBreadcrumb(crumb))).not.toMatch(DIGIT_RUN);
  });
});
