import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_STORAGE_KEY,
  clearSavedSession,
  isSessionRejected,
  loadSession,
  memoryStorage,
  purgePersistedTokens,
  saveSession,
  signOut,
} from "../cognito";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("Cognito token storage", () => {
  it("drops tokens an earlier build cached in localStorage, and nothing else", () => {
    const prefix = "CognitoIdentityServiceProvider.client.+15555550100";
    window.localStorage.setItem(`${prefix}.refreshToken`, "rt");
    window.localStorage.setItem(`${prefix}.idToken`, "id");
    window.localStorage.setItem("CognitoIdentityServiceProvider.client.LastAuthUser", "u");
    window.localStorage.setItem("gb-theme", "dark");

    purgePersistedTokens();

    expect(Object.keys(window.localStorage)).toEqual(["gb-theme"]);
  });

  it("keeps the library cache in memory and clears it on sign-out", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    memoryStorage.setItem("CognitoIdentityServiceProvider.c.u.refreshToken", "rt");
    expect(setItem).not.toHaveBeenCalled();
    expect(memoryStorage.getItem("CognitoIdentityServiceProvider.c.u.refreshToken")).toBe("rt");

    signOut();

    expect(memoryStorage.getItem("CognitoIdentityServiceProvider.c.u.refreshToken")).toBeNull();
  });

  it("leaves the app's saved session alone when purging legacy keys", () => {
    saveSession({ username: "+15555550100", refreshToken: "rt" });
    purgePersistedTokens();
    expect(loadSession()).toEqual({ username: "+15555550100", refreshToken: "rt" });
  });
});

describe("saved session (GB-F5-1)", () => {
  it("round-trips the username and refresh token only", () => {
    saveSession({ username: "+15555550100", refreshToken: "rt" });
    expect(JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) ?? "")).toEqual({
      username: "+15555550100",
      refreshToken: "rt",
    });
    expect(loadSession()).toEqual({ username: "+15555550100", refreshToken: "rt" });
  });

  it("treats a malformed entry as no session and removes it", () => {
    for (const bad of [
      "{oops",
      "null",
      '{"username":"+1"}',
      '{"username":"","refreshToken":"x"}',
    ]) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, bad);
      expect(loadSession()).toBeNull();
      expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    }
  });

  it("sign-out deletes the saved session", () => {
    saveSession({ username: "+15555550100", refreshToken: "rt" });
    signOut("rt");
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(loadSession()).toBeNull();
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => saveSession({ username: "+15555550100", refreshToken: "rt" })).not.toThrow();
    expect(loadSession()).toBeNull();
    expect(() => clearSavedSession()).not.toThrow();
  });

  it("tells a refused refresh token from a transient failure", () => {
    const err = (code: string) => Object.assign(new Error(code), { code });
    expect(isSessionRejected(err("NotAuthorizedException"))).toBe(true);
    expect(isSessionRejected(err("UserNotFoundException"))).toBe(true);
    expect(isSessionRejected(err("NetworkError"))).toBe(false);
    expect(isSessionRejected(err("TooManyRequestsException"))).toBe(false);
    expect(isSessionRejected(new TypeError("Failed to fetch"))).toBe(false);
    expect(isSessionRejected(null)).toBe(false);
  });
});
