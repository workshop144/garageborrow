// AuthProvider state machine with the Cognito wrapper and the API mocked:
// sign-in, OTP, invite join, token refresh, refresh failure and sign-out.

import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cognito = vi.hoisted(() => ({
  startSignIn: vi.fn(() => Promise.resolve({ session: "challenge" })),
  confirmOtp: vi.fn(),
  refreshSession: vi.fn(),
  signOut: vi.fn(),
  purgePersistedTokens: vi.fn(),
}));
vi.mock("../cognito", () => cognito);

const apiMock = vi.hoisted(() => ({ post: vi.fn(() => Promise.resolve({})) }));
const sentry = vi.hoisted(() => ({ captureError: vi.fn() }));
vi.mock("../../api", () => ({ api: apiMock }));
vi.mock("../../sentry", () => sentry);

import { AuthProvider, useAuth } from "../AuthContext";
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
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.clearAllMocks();
  cognito.confirmOtp.mockResolvedValue(tokens(1));
});

afterEach(() => {
  vi.useRealTimers();
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
  it("purges legacy tokens on mount and starts anonymous", () => {
    mount();
    expect(cognito.purgePersistedTokens).toHaveBeenCalled();
    expect(screen.getByTestId("status").textContent).toBe("anonymous");
    expect(auth.getIdToken()).toBeNull();
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

  it("signs out when a refresh fails", async () => {
    cognito.refreshSession.mockRejectedValueOnce(new Error("revoked"));
    mount();
    await signIn();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_600_000);
    });
    expect(cognito.signOut).toHaveBeenCalledWith();
    expect(auth.status).toBe("anonymous");
    expect(auth.getIdToken()).toBeNull();
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
