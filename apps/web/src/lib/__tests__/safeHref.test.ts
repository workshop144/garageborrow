import { describe, expect, it } from "vitest";

import { safeHref } from "../safeHref";

describe("safeHref", () => {
  it.each([
    "http://example.com",
    "https://example.com",
    "https://example.com/path?q=1#frag",
    "http://localhost:3000",
    "HTTP://EXAMPLE.COM",
  ])("returns %s for safe URL", (url) => {
    expect(safeHref(url)).toBe(url);
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "javascript:%20fetch('/v1/me')",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox",
    "file:///etc/passwd",
    "ftp://example.com",
    "ws://example.com",
    "mailto:foo@example.com",
    "tel:+15551234567",
    "not a url",
    "",
  ])("returns undefined for unsafe URL %s", (url) => {
    expect(safeHref(url)).toBeUndefined();
  });

  it("returns undefined for null/undefined", () => {
    expect(safeHref(null)).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });

  it("returns undefined for leading-whitespace bypass attempts", () => {
    expect(safeHref("\tjavascript:alert(1)")).toBeUndefined();
    expect(safeHref(" javascript:alert(1)")).toBeUndefined();
    expect(safeHref("\njavascript:alert(1)")).toBeUndefined();
  });
});
