import type { JSX } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { api } from "../api";
import { captureError } from "../sentry";
import {
  confirmOtp,
  isSessionRejected,
  loadSession,
  purgePersistedTokens,
  refreshSession,
  saveSession,
  signOut as cognitoSignOut,
  startSignIn,
} from "./cognito";
import type { AuthTokens } from "./cognito";

type AuthState = {
  tokens: AuthTokens | null;
  username: string | null;
  pendingPhone: string | null;
  status: "loading" | "anonymous" | "challenge" | "authenticated";
};

type AuthContextValue = AuthState & {
  beginPhoneSignIn: (phoneE164: string) => Promise<void>;
  submitOtp: (code: string) => Promise<void>;
  signOut: () => void;
  getIdToken: () => string | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const REFRESH_LEEWAY_MS = 60_000;
// A refresh that failed for a reason other than Cognito refusing the token
// (offline, throttled) is retried after this long instead of ending the session.
export const REFRESH_RETRY_MS = 30_000;

const ANONYMOUS: AuthState = {
  tokens: null,
  username: null,
  pendingPhone: null,
  status: "anonymous",
};

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  // A saved session (GB-F5-1) is restored on mount; until that refresh settles
  // the app shows "loading" rather than the sign-in page.
  const [initialSession] = useState(loadSession);
  const [state, setState] = useState<AuthState>(() =>
    initialSession ? { ...ANONYMOUS, status: "loading" } : ANONYMOUS,
  );
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped by every sign-in and sign-out, so a refresh that was already in
  // flight cannot bring back a session the user has since left.
  const generation = useRef(0);

  const clearTimer = useCallback(() => {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
  }, []);

  const endSession = useCallback(() => {
    generation.current++;
    clearTimer();
    // Whatever ended it, the session is over: clear its tokens and the saved copy.
    cognitoSignOut();
    setState(ANONYMOUS);
  }, [clearTimer]);

  const scheduleRefresh = useCallback(
    (initial: AuthTokens, username: string) => {
      const gen = generation.current;
      const attempt = (refreshToken: string, ms: number): void => {
        clearTimer();
        refreshTimer.current = setTimeout(() => {
          void (async () => {
            try {
              const next = await refreshSession(refreshToken, username);
              if (gen !== generation.current) return;
              saveSession({ username, refreshToken: next.refreshToken });
              setState((s) => ({ ...s, tokens: next, status: "authenticated" }));
              schedule(next);
            } catch (err) {
              if (gen !== generation.current) return;
              if (isSessionRejected(err)) endSession();
              else attempt(refreshToken, REFRESH_RETRY_MS);
            }
          })();
        }, ms);
      };
      // Each successful refresh schedules the next one for the new tokens.
      const schedule = (tokens: AuthTokens): void => {
        attempt(
          tokens.refreshToken,
          Math.max(tokens.expiresAt - Date.now() - REFRESH_LEEWAY_MS, 5_000),
        );
      };
      schedule(initial);
    },
    [clearTimer, endSession],
  );

  // Restore the saved session once. Also drop tokens an earlier build left in
  // localStorage under the library's own keys.
  useEffect(() => {
    purgePersistedTokens();
    const saved = initialSession;
    if (!saved) return;
    const gen = generation.current;
    let cancelled = false;
    void (async () => {
      try {
        const tokens = await refreshSession(saved.refreshToken, saved.username);
        if (cancelled || gen !== generation.current) return;
        saveSession({ username: saved.username, refreshToken: tokens.refreshToken });
        setState({
          tokens,
          username: saved.username,
          pendingPhone: null,
          status: "authenticated",
        });
        scheduleRefresh(tokens, saved.username);
      } catch (err) {
        if (cancelled || gen !== generation.current) return;
        // A refused token is gone for good. Any other failure (offline at
        // launch) keeps the saved session so the next launch tries again
        // instead of costing a text.
        if (isSessionRejected(err)) cognitoSignOut();
        setState(ANONYMOUS);
      }
    })();
    return () => {
      // StrictMode runs effects twice in development; only the last run applies.
      cancelled = true;
    };
  }, [initialSession, scheduleRefresh]);

  useEffect(() => clearTimer, [clearTimer]);

  // Sign-up is invite-only: /auth/start creates the account for an invited number
  // (and rate-limits texts), then Cognito's SMS-code challenge starts. Also used
  // for "resend": a fresh challenge sends a fresh code for this session.
  const beginPhoneSignIn = useCallback(
    async (phoneE164: string) => {
      await api.post("/auth/start", { phone: phoneE164 });
      // A new sign-in supersedes any restore or refresh still in flight.
      generation.current++;
      clearTimer();
      await startSignIn(phoneE164);
      setState({
        tokens: null,
        username: phoneE164,
        pendingPhone: phoneE164,
        status: "challenge",
      });
    },
    [clearTimer],
  );

  const submitOtp = useCallback(
    async (code: string) => {
      const phone = state.pendingPhone;
      if (!phone) {
        throw new Error("No pending phone sign-in.");
      }
      const tokens = await confirmOtp(phone, code);
      // Accept any pending garage invites. The token provider only sees the new
      // tokens after the next render, so the ID token is passed explicitly.
      try {
        await api.post("/me/join", undefined, {
          headers: { Authorization: `Bearer ${tokens.idToken}` },
        });
      } catch (err) {
        captureError(err, { url: "/me/join", method: "POST" });
      }
      generation.current++;
      saveSession({ username: phone, refreshToken: tokens.refreshToken });
      setState({
        tokens,
        username: phone,
        pendingPhone: null,
        status: "authenticated",
      });
      scheduleRefresh(tokens, phone);
    },
    [state.pendingPhone, scheduleRefresh],
  );

  const refreshToken = state.tokens?.refreshToken;
  const signOut = useCallback(() => {
    generation.current++;
    // Revokes the refresh token at Cognito and deletes the saved session. While
    // a restore is still in flight only the saved copy holds the token.
    cognitoSignOut(refreshToken ?? loadSession()?.refreshToken);
    clearTimer();
    setState(ANONYMOUS);
  }, [refreshToken, clearTimer]);

  // The API authorises on the ID token: it carries the verified phone number (the access token does not).
  const getIdToken = useCallback(() => state.tokens?.idToken ?? null, [state.tokens]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, beginPhoneSignIn, submitOtp, signOut, getIdToken }),
    [state, beginPhoneSignIn, submitOtp, signOut, getIdToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
