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
import { confirmOtp, refreshSession, signOut as cognitoSignOut, startSignIn } from "./cognito";
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

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<AuthState>({
    tokens: null,
    username: null,
    pendingPhone: null,
    status: "anonymous",
  });
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRefresh = useCallback((tokens: AuthTokens, username: string) => {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
    }
    const ms = Math.max(tokens.expiresAt - Date.now() - REFRESH_LEEWAY_MS, 5_000);
    refreshTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const next = await refreshSession(tokens.refreshToken, username);
          setState((s) => ({ ...s, tokens: next, status: "authenticated" }));
          scheduleRefresh(next, username);
        } catch {
          setState({
            tokens: null,
            username: null,
            pendingPhone: null,
            status: "anonymous",
          });
        }
      })();
    }, ms);
  }, []);

  useEffect(() => {
    return () => {
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
      }
    };
  }, []);

  // Sign-up is invite-only: /auth/start creates the account for an invited number
  // (and rate-limits texts), then Cognito's SMS-code challenge starts. Also used
  // for "resend": a fresh challenge sends a fresh code for this session.
  const beginPhoneSignIn = useCallback(async (phoneE164: string) => {
    await api.post("/auth/start", { phone: phoneE164 });
    await startSignIn(phoneE164);
    setState({
      tokens: null,
      username: phoneE164,
      pendingPhone: phoneE164,
      status: "challenge",
    });
  }, []);

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

  const signOut = useCallback(() => {
    cognitoSignOut();
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
    setState({
      tokens: null,
      username: null,
      pendingPhone: null,
      status: "anonymous",
    });
  }, []);

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
