// Sign-in, OTP, refresh and sign-out against a mocked amazon-cognito-identity-js;
// the RevokeToken call is a stubbed fetch. Nothing reaches Cognito.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as CognitoModule from "../cognito";

const lib = vi.hoisted(() => {
  type Cb = Record<string, (...a: unknown[]) => void>;
  const state = {
    initiate: (cb: Cb) => cb["customChallenge"]?.(),
    answer: (_code: string, cb: Cb) => cb["onSuccess"]?.(state.session),
    refresh: (_t: unknown, cb: (err: Error | null, s: unknown) => void) => cb(null, state.session),
    session: {
      getIdToken: () => ({ getJwtToken: () => "id-1" }),
      getAccessToken: () => ({ getJwtToken: () => "acc-1", getExpiration: () => 2_000_000_000 }),
      getRefreshToken: () => ({ getToken: () => "ref-1" }),
    },
    users: [] as Array<{ opts: Record<string, unknown>; flow?: string }>,
    currentSignOut: vi.fn(),
    poolData: undefined as unknown,
  };
  class CognitoUser {
    flow?: string;
    constructor(public opts: Record<string, unknown>) {
      state.users.push(this as unknown as { opts: Record<string, unknown> });
    }
    setAuthenticationFlowType(f: string) {
      this.flow = f;
    }
    initiateAuth(_d: unknown, cb: Cb) {
      state.initiate(cb);
    }
    sendCustomChallengeAnswer(code: string, cb: Cb) {
      state.answer(code, cb);
    }
    refreshSession(t: unknown, cb: (err: Error | null, s: unknown) => void) {
      state.refresh(t, cb);
    }
  }
  class CognitoUserPool {
    constructor(data: unknown) {
      state.poolData = data;
    }
    getCurrentUser() {
      return { signOut: state.currentSignOut };
    }
  }
  class AuthenticationDetails {
    constructor(public d: unknown) {}
  }
  return { state, CognitoUser, CognitoUserPool, AuthenticationDetails };
});

vi.mock("amazon-cognito-identity-js", () => ({
  CognitoUser: lib.CognitoUser,
  CognitoUserPool: lib.CognitoUserPool,
  AuthenticationDetails: lib.AuthenticationDetails,
}));

const PHONE = "+15555550123";
type Mod = typeof CognitoModule;

async function load(poolId = "us-east-2_TESTPOOL", clientId = "client-1"): Promise<Mod> {
  vi.resetModules();
  vi.stubEnv("VITE_COGNITO_USER_POOL_ID", poolId);
  vi.stubEnv("VITE_COGNITO_CLIENT_ID", clientId);
  return import("../cognito");
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  lib.state.users.length = 0;
  lib.state.currentSignOut.mockClear();
  lib.state.initiate = (cb) => cb["customChallenge"]?.();
  lib.state.answer = (_c, cb) => cb["onSuccess"]?.(lib.state.session);
  lib.state.refresh = (_t, cb) => cb(null, lib.state.session);
  fetchMock = vi.fn(() => Promise.resolve(new Response("{}")));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("cognito client", () => {
  it("refuses to start when the pool is not configured", async () => {
    const m = await load("", "");
    await expect(m.startSignIn(PHONE)).rejects.toThrow("Cognito not configured");
  });

  it("starts a CUSTOM_AUTH sign-in with in-memory token storage", async () => {
    const m = await load();
    await expect(m.startSignIn(PHONE)).resolves.toEqual({ session: "challenge" });
    const u = lib.state.users[0] as unknown as { opts: Record<string, unknown>; flow: string };
    expect(u.flow).toBe("CUSTOM_AUTH");
    expect(u.opts["Username"]).toBe(PHONE);
    expect(u.opts["Storage"]).toBe(m.memoryStorage);
    expect((lib.state.poolData as { Storage: unknown }).Storage).toBe(m.memoryStorage);
  });

  it("surfaces an initiate failure", async () => {
    lib.state.initiate = (cb) => cb["onFailure"]?.(new Error("UserNotFound"));
    const m = await load();
    await expect(m.startSignIn(PHONE)).rejects.toThrow("UserNotFound");
  });

  it("turns a correct code into tokens with the expiry in ms", async () => {
    const m = await load();
    await m.startSignIn(PHONE);
    await expect(m.confirmOtp(PHONE, "123456")).resolves.toEqual({
      idToken: "id-1",
      accessToken: "acc-1",
      refreshToken: "ref-1",
      expiresAt: 2_000_000_000_000,
    });
  });

  it("rejects a wrong code and an OTP with no started sign-in", async () => {
    lib.state.answer = (_c, cb) => cb["onFailure"]?.(new Error("NotAuthorized"));
    const m = await load();
    await expect(m.confirmOtp(PHONE, "1")).rejects.toThrow("Sign-in session expired");
    await m.startSignIn(PHONE);
    await expect(m.confirmOtp(PHONE, "000000")).rejects.toThrow("NotAuthorized");
  });

  it("refreshes a session and reports refresh errors", async () => {
    const m = await load();
    await expect(m.refreshSession("ref-1", PHONE)).resolves.toMatchObject({ idToken: "id-1" });
    lib.state.refresh = (_t, cb) => cb(new Error("expired"), null);
    await expect(m.refreshSession("ref-1", PHONE)).rejects.toThrow("expired");
  });

  it("revokes the refresh token at the pool's regional endpoint on sign-out", async () => {
    const m = await load();
    await m.startSignIn(PHONE);
    m.signOut("ref-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://cognito-idp.us-east-2.amazonaws.com/");
    expect((init.headers as Record<string, string>)["X-Amz-Target"]).toBe(
      "AWSCognitoIdentityProviderService.RevokeToken",
    );
    expect(JSON.parse(String(init.body))).toEqual({ Token: "ref-1", ClientId: "client-1" });
    expect(lib.state.currentSignOut).toHaveBeenCalled();
    // The pending sign-in is forgotten too.
    await expect(m.confirmOtp(PHONE, "123456")).rejects.toThrow("Sign-in session expired");
  });

  it("signs out without a token or configuration, and survives a failed revoke", async () => {
    let m = await load("", "");
    expect(() => m.signOut("ref-1")).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    m = await load();
    fetchMock.mockImplementation(() => Promise.reject(new Error("offline")));
    expect(() => m.signOut("ref-1")).not.toThrow();
    m.signOut();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
