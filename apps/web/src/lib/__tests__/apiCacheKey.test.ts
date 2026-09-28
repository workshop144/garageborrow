import { describe, expect, it } from "vitest";

import { apiCacheKey } from "../apiCacheKey";

function token(sub: string): string {
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "RS256" })}.${b64({ sub })}.sig`;
}

function req(auth?: string): Request {
  return new Request("https://app.example/v1/me", auth ? { headers: { Authorization: auth } } : {});
}

describe("apiCacheKey", () => {
  it("gives different users different cache entries for the same URL", () => {
    const a = apiCacheKey(req(`Bearer ${token("user-a")}`));
    const b = apiCacheKey(req(`Bearer ${token("user-b")}`));
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toBe(b);
    expect(apiCacheKey(req(`Bearer ${token("user-a")}`))).toBe(a);
  });

  it("does not cache requests without a usable bearer token", () => {
    expect(apiCacheKey(req())).toBeUndefined();
    expect(apiCacheKey(req("Bearer not-a-jwt"))).toBeUndefined();
  });
});
