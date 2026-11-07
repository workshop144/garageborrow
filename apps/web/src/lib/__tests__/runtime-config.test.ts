// 2026-11-07 review F2: the deployed app learns its API URL and Cognito ids
// from /config.json, which the deploy job writes from the stack outputs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiBase,
  cognitoIds,
  loadRuntimeConfig,
  sanitizeRuntimeConfig,
  setRuntimeConfigForTest,
} from "../runtime-config";

const GOOD = {
  apiBaseUrl: "https://abc123.execute-api.us-east-2.amazonaws.com",
  userPoolId: "us-east-2_AbCdEf123",
  userPoolClientId: "4l1c3cl13nt1d",
};

const jsonResponse = (body: unknown, type = "application/json") =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: 200,
    headers: { "content-type": type },
  });

beforeEach(() => {
  setRuntimeConfigForTest({});
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runtime config", () => {
  it("uses /config.json for the API base and Cognito ids", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(GOOD)));
    await loadRuntimeConfig(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith("/config.json", { cache: "no-store" });
    expect(apiBase()).toBe(`${GOOD.apiBaseUrl}/v1`);
    expect(cognitoIds()).toEqual({ userPoolId: GOOD.userPoolId, clientId: GOOD.userPoolClientId });
  });

  it("falls back to the VITE_* variables when the file is the SPA fallback HTML", async () => {
    vi.stubEnv("VITE_COGNITO_USER_POOL_ID", "us-east-2_Local");
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse("<!doctype html>", "text/html")));
    await loadRuntimeConfig(fetchImpl as unknown as typeof fetch);
    expect(apiBase()).toBe("/v1");
    expect(cognitoIds().userPoolId).toBe("us-east-2_Local");
  });

  it("offline, uses the last config it loaded", async () => {
    await loadRuntimeConfig((() => Promise.resolve(jsonResponse(GOOD))) as unknown as typeof fetch);
    setRuntimeConfigForTest({});
    await loadRuntimeConfig((() =>
      Promise.reject(new TypeError("offline"))) as unknown as typeof fetch);
    expect(apiBase()).toBe(`${GOOD.apiBaseUrl}/v1`);
  });

  it("ignores values of the wrong shape", () => {
    expect(
      sanitizeRuntimeConfig({
        apiBaseUrl: "http://abc.execute-api.us-east-2.amazonaws.com",
        userPoolId: "not a pool",
        userPoolClientId: "x y",
      }),
    ).toEqual({});
    expect(sanitizeRuntimeConfig({ apiBaseUrl: "https://evil.example/v1?x=1" })).toEqual({});
    expect(sanitizeRuntimeConfig({ apiBaseUrl: "javascript:alert(1)" })).toEqual({});
    expect(sanitizeRuntimeConfig({ apiBaseUrl: `${GOOD.apiBaseUrl}/` })).toEqual({
      apiBaseUrl: GOOD.apiBaseUrl,
    });
    expect(sanitizeRuntimeConfig(null)).toEqual({});
  });
});
