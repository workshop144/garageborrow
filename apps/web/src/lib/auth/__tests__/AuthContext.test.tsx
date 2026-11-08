// AuthProvider state machine with the Cognito network calls and the API mocked:
// sign-in, OTP, invite join, token refresh, refresh failure, sign-out, and the
// saved session that survives a reload (GB-F5-1). The saved-session helpers are
// the real ones, against jsdom's localStorage.

import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as CognitoModule from "../cognito";

const cognito = vi.hoisted(() => ({
  startSignIn: vi.fn(() => Promise.resolve({ session: "challenge" })),
  confirmOtp: vi.fn(),
  refreshSession: vi.fn(),
  signOut: vi.fn(),
  purgePersistedTokens: vi.fn(),
}));
vi.mock("../cognito", async (importOriginal) => {
  const actual = await importOriginal<typeof CognitoModule>();
  // signOut and the legacy purge run for real (no pool is configured here, so
  // nothing reaches Cognito) behind spies the tests can assert on.
  cognito.signOut.mockImplementation((rt?: string) => actual.signOut(rt));
  cognito.purgePersistedTokens.mockImplementation(() => actual.purgePersistedTokens());
  return {
    ...actual,
    startSignIn: cognito.startSignIn,
    confirmOtp: cognito.confirmOtp,
    refreshSession: cognito.refreshSession,
    signOut: cognito.signOut,
    purgePersistedTokens: cognito.purgePersistedTokens,
  };
});

const apiMock = vi.hoisted(() => ({ post: vi.fn(() => Promise.resolve({})) }));
const sentry = vi.hoisted(() => ({ captureError: vi.fn() }));
vi.mock("../../api", () => ({ api: apiMock }));
vi.mock("../../sentry", () => sentry);

import { AuthProvider, REFRESH_RETRY_MS, useAuth } from "../AuthContext";
import { SESSION_STORAGE_KEY } from "../cognito";
import { ProtectedRoute } from "../ProtectedRoute";

const PHONE = "+15555550123";
const NOW = 1_800_000_000_000;

function tokens(n: number, ttlMs = 3_600_000) {
  return {
    idToken: `id-${n}`,
    accessToken: `acc-${n}`,
    refreshToken: `ref-${n}`,
    expiresAt: NOW + ttlMs,
  };
}

let auth: ReturnType<typeof useAuth>;
// Captures the latest context value for the test body to drive.
function capture(a: ReturnType<typeof useAuth>): ReturnType<typeof useAuth> {
  auth = a;
  return a;
}
function Probe() {
  const a = capture(useAuth());
  return <div data-testid="status">{a.status}</div>;
}

function mount() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

function cognitoError(code: string): Error {
  return Object.assign(new Error(code), { code, name: code });
}

function saved(): unknown {
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.clearAllMocks();
  window.localStorage.clear();
  cognito.confirmOtp.mockResolvedValue(tokens(1));
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

async function signIn() {
  await act(async () => {
    await auth.beginPhoneSignIn(PHONE);
  });
  await act(async () => {
    await auth.submitOtp("123456");
  });
}

describe("AuthProvider", () => {
  it("purges legacy tokens on mount and starts anonymous with no saved session", () => {
    mount();
    expect(cognito.purgePersistedTokens).toHaveBeenCalled();
    expect(screen.getByTestId("status").textContent).toBe("anonymous");
    expect(auth.getIdToken()).toBeNull();
    expect(cognito.refreshSession).not.toHaveBeenCalled();
  });

  it("asks the API to start, then waits for the code", async () => {
    mount();
    await act(async () => {
      await auth.beginPhoneSignIn(PHONE);
    });
    expect(apiMock.post).toHaveBeenCalledWith("/auth/start", { phone: PHONE });
    expect(cognito.startSignIn).toHaveBeenCalledWith(PHONE);
    expect(auth.status).toBe("challenge");
    expect(auth.pendingPhone).toBe(PHONE);
  });

  it("does not start the Cognito challenge when /auth/start fails (rate limit)", async () => {
    apiMock.post.mockRejectedValueOnce(new Error("rate_limited"));
    mount();
    await expect(auth.beginPhoneSignIn(PHONE)).rejects.toThrow("rate_limited");
    expect(cognito.startSignIn).not.toHaveBeenCalled();
    expect(auth.status).toBe("anonymous");
  });

  it("refuses an OTP with no sign-in in progress", async () => {
    mount();
    await expect(auth.submitOtp("1")).rejects.toThrow("No pending phone sign-in.");
  });

  it("signs in, joins invites with the new ID token and exposes it", async () => {
    mount();
    await signIn();
    expect(cognito.confirmOtp).toHaveBeenCalledWith(PHONE, "123456");
    expect(apiMock.post).toHaveBeenLastCalledWith("/me/join", undefined, {
      headers: { Authorization: "Bearer id-1" },
    });
    expect(auth.status).toBe("authenticated");
    expect(auth.getIdToken()).toBe("id-1");
  });

  it("still signs in when the invite join fails, and reports it", async () => {
    mount();
    await act(async () => {
      await auth.beginPhoneSignIn(PHONE);
    });
    apiMock.post.mockRejectedValueOnce(new Error("join failed"));
    await act(async () => {
      await auth.submitOtp("123456");
    });
    expect(auth.status).toBe("authenticated");
    expect(sentry.captureError).toHaveBeenCalledWith(expect.any(Error), {
      url: "/me/join",
      method: "POST",
    });
  });

  it("keeps the state in challenge after a wrong code", async () => {
    cognito.confirmOtp.mockRejectedValueOnce(new Error("NotAuthorized"));
    mount();
    await act(async () => {
      await auth.beginPhoneSignIn(PHONE);
    });
    await expect(auth.submitOtp("000000")).rejects.toThrow("NotAuthorized");
    expect(auth.status).toBe("challenge");
  });

  it("refreshes a minute before expiry and keeps refreshing", async () => {
    cognito.refreshSession.mockResolvedValueOnce(tokens(2)).mockResolvedValueOnce(tokens(3));
    mount();
    await signIn();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_600_000 - 60_000 - 1);
    });
    expect(cognito.refreshSession).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(cognito.refreshSession).toHaveBeenCalledWith("ref-1", PHONE);
    expect(auth.getIdToken()).toBe("id-2");
    // tokens(2) expires at NOW+1h too, so the next refresh is at the 5 s floor.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(cognito.refreshSession).toHaveBeenLastCalledWith("ref-2", PHONE);
    expect(auth.getIdToken()).toBe("id-3");
  });

  it("signs out and forgets the saved session when Cognito refuses the refresh token", async () => {
    cognito.refreshSession.mockRejectedValueOnce(cognitoError("NotAuthorizedException"));
    mount();
    await signIn();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_600_000);
    });
    expect(cognito.signOut).toHaveBeenCalledWith();
    expect(auth.status).toBe("anonymous");
    expect(auth.getIdToken()).toBeNull();
    expect(saved()).toBeNull();
  });

  it("retries a refresh that failed offline instead of ending the session", async () => {
    cognito.refreshSession
      .mockRejectedValueOnce(cognitoError("NetworkError"))
      .mockResolvedValueOnce(tokens(2));
    mount();
    await signIn();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_600_000 - 60_000);
    });
    expect(cognito.refreshSession).toHaveBeenCalledTimes(1);
    expect(auth.status).toBe("authenticated");
    expect(cognito.signOut).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_RETRY_MS);
    });
    expect(cognito.refreshSession).toHaveBeenCalledTimes(2);
    expect(cognito.refreshSession).toHaveBeenLastCalledWith("ref-1", PHONE);
    expect(auth.getIdToken()).toBe("id-2");
    expect(saved()).toEqual({ username: PHONE, refreshToken: "ref-2" });
  });

  it("sign-out revokes the refresh token and cancels the refresh timer", async () => {
    mount();
    await signIn();
    act(() => auth.signOut());
    expect(cognito.signOut).toHaveBeenCalledWith("ref-1");
    expect(auth.status).toBe("anonymous");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 3_600_000);
    });
    expect(cognito.refreshSession).not.toHaveBeenCalled();
  });

  it("saves only the refresh token and username, never the ID or access token", async () => {
    mount();
    await signIn();
    expect(saved()).toEqual({ username: PHONE, refreshToken: "ref-1" });
    const everything = Object.keys(window.localStorage)
      .map((k) => `${k}=${window.localStorage.getItem(k)}`)
      .join("\n");
    expect(everything).not.toContain("id-1");
    expect(everything).not.toContain("acc-1");
  });

  it("remounting the provider (a reload or a new app launch) keeps the session without a code", async () => {
    const first = mount();
    await signIn();
    first.unmount();
    vi.clearAllMocks();

    cognito.refreshSession.mockResolvedValueOnce(tokens(2));
    mount();
    expect(auth.status).toBe("loading");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(cognito.refreshSession).toHaveBeenCalledWith("ref-1", PHONE);
    expect(cognito.startSignIn).not.toHaveBeenCalled();
    expect(apiMock.post).not.toHaveBeenCalled();
    expect(auth.status).toBe("authenticated");
    expect(auth.username).toBe(PHONE);
    expect(auth.getIdToken()).toBe("id-2");
    expect(saved()).toEqual({ username: PHONE, refreshToken: "ref-2" });

    // The restored session keeps refreshing itself.
    cognito.refreshSession.mockResolvedValueOnce(tokens(3, 7_200_000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_600_000 - 60_000);
    });
    expect(cognito.refreshSession).toHaveBeenLastCalledWith("ref-2", PHONE);
    expect(auth.getIdToken()).toBe("id-3");
  });

  it("sign-out clears the saved session, so the next launch starts signed out", async () => {
    const first = mount();
    await signIn();
    act(() => auth.signOut());
    expect(cognito.signOut).toHaveBeenCalledWith("ref-1");
    expect(saved()).toBeNull();
    first.unmount();

    mount();
    expect(auth.status).toBe("anonymous");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(cognito.refreshSession).not.toHaveBeenCalled();
    expect(auth.status).toBe("anonymous");
  });

  it("drops a saved session whose refresh token Cognito refuses", async () => {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ username: PHONE, refreshToken: "ref-old" }),
    );
    cognito.refreshSession.mockRejectedValueOnce(cognitoError("NotAuthorizedException"));
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(auth.status).toBe("anonymous");
    expect(saved()).toBeNull();
  });

  it("keeps a saved session it could not refresh offline, for the next launch", async () => {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ username: PHONE, refreshToken: "ref-old" }),
    );
    cognito.refreshSession.mockRejectedValueOnce(cognitoError("NetworkError"));
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(auth.status).toBe("anonymous");
    expect(saved()).toEqual({ username: PHONE, refreshToken: "ref-old" });
  });

  it("a restore still in flight cannot undo a sign-out", async () => {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ username: PHONE, refreshToken: "ref-old" }),
    );
    let resolve: (t: ReturnType<typeof tokens>) => void = () => undefined;
    cognito.refreshSession.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    mount();
    act(() => auth.signOut());
    // The token being restored is revoked too.
    expect(cognito.signOut).toHaveBeenCalledWith("ref-old");
    await act(async () => {
      resolve(tokens(2));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(auth.status).toBe("anonymous");
    expect(auth.getIdToken()).toBeNull();
    expect(saved()).toBeNull();
  });

  it("ignores a corrupt saved session", () => {
    window.localStorage.setItem(SESSION_STORAGE_KEY, "{not json");
    mount();
    expect(auth.status).toBe("anonymous");
    expect(cognito.refreshSession).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("useAuth outside the provider throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow("useAuth must be used inside <AuthProvider>");
    spy.mockRestore();
  });
});

describe("ProtectedRoute", () => {
  function app(start: string) {
    render(
      <AuthProvider>
        <Probe />
        <MemoryRouter initialEntries={[start]}>
          <Routes>
            <Route path="/login" element={<div>login page</div>} />
            <Route
              path="/g/x"
              element={
                <ProtectedRoute>
                  <div>secret</div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );
  }

  it("redirects an anonymous visitor to /login", () => {
    app("/g/x");
    expect(screen.getByText("login page")).toBeInTheDocument();
    expect(screen.queryByText("secret")).toBeNull();
  });

  it("waits for a saved session to restore instead of sending a member to /login", async () => {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ username: PHONE, refreshToken: "ref-1" }),
    );
    cognito.refreshSession.mockResolvedValueOnce(tokens(2));
    app("/g/x");
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("login page")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("secret")).toBeInTheDocument();
    expect(screen.queryByText("login page")).toBeNull();
  });

  it("renders the page for a signed-in user", async () => {
    function Late() {
      const a = capture(useAuth());
      if (a.status !== "authenticated") return null;
      return (
        <MemoryRouter initialEntries={["/g/x"]}>
          <Routes>
            <Route path="/login" element={<div>login page</div>} />
            <Route
              path="/g/x"
              element={
                <ProtectedRoute>
                  <div>secret</div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      );
    }
    render(
      <AuthProvider>
        <Late />
      </AuthProvider>,
    );
    await signIn();
    expect(screen.getByText("secret")).toBeInTheDocument();
    expect(screen.queryByText("login page")).toBeNull();
  });
});
