import { afterEach, describe, expect, it, vi } from "vitest";

import { memoryStorage, purgePersistedTokens, signOut } from "../cognito";

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
});
