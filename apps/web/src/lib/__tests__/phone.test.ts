import { describe, expect, it } from "vitest";

import { formatAsYouType, parsePhone, toE164 } from "../phone";

describe("toE164 (US default)", () => {
  it("normalizes common US formats to E.164", () => {
    expect(toE164("317-555-1234")).toBe("+13175551234");
    expect(toE164("(317) 555 1234")).toBe("+13175551234");
    expect(toE164("3175551234")).toBe("+13175551234");
    expect(toE164("+13175551234")).toBe("+13175551234");
    expect(toE164("1 317-555-1234")).toBe("+13175551234");
  });

  it("returns null for invalid input", () => {
    expect(toE164("")).toBeNull();
    expect(toE164("abc")).toBeNull();
    expect(toE164("123")).toBeNull(); // too short
    expect(toE164("555-1234")).toBeNull(); // 7-digit, no area code
  });
});

describe("parsePhone", () => {
  it("returns national format alongside E.164", () => {
    const p = parsePhone("3175551234");
    expect(p?.e164).toBe("+13175551234");
    expect(p?.national).toMatch(/317/);
    expect(p?.isValid).toBe(true);
  });
});

describe("formatAsYouType", () => {
  it("progressively formats a US number as the user types", () => {
    expect(formatAsYouType("3")).toMatch(/^3/);
    expect(formatAsYouType("3175")).toMatch(/317/);
    expect(formatAsYouType("3175551234")).toMatch(/\(317\)/);
  });

  it("does not throw on partial input", () => {
    expect(() => formatAsYouType("3")).not.toThrow();
    expect(() => formatAsYouType("")).not.toThrow();
  });
});
