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
  getAccessToken: () => string | null;
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

  const beginPhoneSignIn = useCallback(async (phoneE164: string) => {
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

  const getAccessToken = useCallback(() => state.tokens?.accessToken ?? null, [state.tokens]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, beginPhoneSignIn, submitOtp, signOut, getAccessToken }),
    [state, beginPhoneSignIn, submitOtp, signOut, getAccessToken],
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
