import { describe, expect, it } from "vitest";

import { HttpUrl } from "../schemas/common.js";
import {
  NonprofitOrgSchema,
  PushSubscriptionSchema,
  WishlistRequestSchema,
} from "../schemas/index.js";

describe("HttpUrl", () => {
  it.each([
    "http://example.com",
    "https://example.com",
    "https://example.com/path?q=1#frag",
    "http://localhost:3000",
    "HTTP://EXAMPLE.COM",
    "HtTpS://example.com",
  ])("accepts %s", (url) => {
    expect(HttpUrl.safeParse(url).success).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "javascript:%20fetch('/v1/me')",
    "javascript:void(0)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox",
    "file:///etc/passwd",
    "ftp://example.com",
    "ws://example.com",
    "mailto:foo@example.com",
    "tel:+15551234567",
    "not a url",
    "",
  ])("rejects %s", (url) => {
    expect(HttpUrl.safeParse(url).success).toBe(false);
  });

  // The `\t` and `\n` whitespace characters can confuse some URL parsers — make
  // sure we don't accidentally let `\tjavascript:...` slip past the regex.
  it("rejects URLs with leading whitespace before scheme", () => {
    expect(HttpUrl.safeParse("\tjavascript:alert(1)").success).toBe(false);
    expect(HttpUrl.safeParse(" javascript:alert(1)").success).toBe(false);
    expect(HttpUrl.safeParse("\njavascript:alert(1)").success).toBe(false);
  });
});

describe("schema integration: javascript: scheme rejected", () => {
  it("WishlistRequestSchema.reference_url", () => {
    const base = {
      id: "w1",
      garage_id: "g1",
      requester_phone: "+15551234567",
      item_name: "drill",
      status: "open",
      vote_count: 1,
      created_at: "2026-04-25T12:00:00Z",
      updated_at: "2026-04-25T12:00:00Z",
    };
    expect(
      WishlistRequestSchema.safeParse({ ...base, reference_url: "javascript:alert(1)" }).success,
    ).toBe(false);
    expect(
      WishlistRequestSchema.safeParse({ ...base, reference_url: "https://example.com" }).success,
    ).toBe(true);
  });

  it("NonprofitOrgSchema.url / donate_url / logo_url", () => {
    const base = { name: "Org", display_order: 0 };
    expect(NonprofitOrgSchema.safeParse({ ...base, url: "javascript:alert(1)" }).success).toBe(
      false,
    );
    expect(
      NonprofitOrgSchema.safeParse({ ...base, donate_url: "data:text/html,foo" }).success,
    ).toBe(false);
    expect(NonprofitOrgSchema.safeParse({ ...base, logo_url: "vbscript:msgbox" }).success).toBe(
      false,
    );
    expect(
      NonprofitOrgSchema.safeParse({
        ...base,
        url: "https://example.org",
        donate_url: "https://donate.example.org",
        logo_url: "https://cdn.example.org/logo.png",
      }).success,
    ).toBe(true);
  });

  it("PushSubscriptionSchema.endpoint", () => {
    const base = {
      user_phone: "+15551234567",
      keys: { p256dh: "k", auth: "a" },
      created_at: "2026-04-25T12:00:00Z",
    };
    expect(
      PushSubscriptionSchema.safeParse({ ...base, endpoint: "javascript:alert(1)" }).success,
    ).toBe(false);
    expect(
      PushSubscriptionSchema.safeParse({
        ...base,
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      }).success,
    ).toBe(true);
  });
});
