import { describe, expect, it } from "vitest";

import { scrubPhones, scrubPhonesDeep } from "../scrub-phones.js";

describe("scrubPhones", () => {
  it("replaces raw and URL-encoded E.164 numbers", () => {
    expect(scrubPhones("/v1/g/g1/admin/members/+15555550123")).toBe(
      "/v1/g/g1/admin/members/[phone]",
    );
    expect(scrubPhones("/v1/g/g1/admin/invites/%2B15555550123")).toBe(
      "/v1/g/g1/admin/invites/[phone]",
    );
    expect(scrubPhones("/admin/invites/%2b447700900123?x=1")).toBe("/admin/invites/[phone]?x=1");
  });

  it("leaves text without phones alone", () => {
    expect(scrubPhones("/v1/g/g1/items/01HXYZ")).toBe("/v1/g/g1/items/01HXYZ");
    expect(scrubPhones("+12345")).toBe("+12345");
  });
});

describe("scrubPhonesDeep", () => {
  it("scrubs nested strings and keys without touching the input", () => {
    const input = {
      message: "failed for +15555550123",
      request: { url: "https://x/v1/admin/members/%2B15555550123" },
      breadcrumbs: [{ data: { url: "/admin/invites/%2B15555550123" } }],
      extra: { "+15555550123": 1, n: 5 },
    };
    const out = scrubPhonesDeep(input);
    expect(JSON.stringify(out)).not.toMatch(/\d{6,}/);
    expect(out.request.url).toBe("https://x/v1/admin/members/[phone]");
    expect(out.extra).toEqual({ "[phone]": 1, n: 5 });
    expect(input.message).toBe("failed for +15555550123");
  });

  it("handles cycles and leaves non-plain objects as they are", () => {
    const err = new Error("x");
    const a: Record<string, unknown> = { err, s: "+15555550123" };
    a.self = a;
    const out = scrubPhonesDeep(a);
    expect(out.err).toBe(err);
    expect(out.s).toBe("[phone]");
    expect(out.self).toBe(out);
  });
});
