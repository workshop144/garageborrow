import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  type CognitoUserSession,
  type ICognitoStorage,
  type ICognitoUserPoolData,
} from "amazon-cognito-identity-js";

import { cognitoIds } from "../runtime-config";

// The library's token cache (ID, access and refresh token) stays in memory. Its
// default is window.localStorage, which would keep every token on the device
// under keys this app does not manage. The one thing that outlives a reload is
// the saved session below (refresh token + username), which the app owns and
// clears on sign-out.
const memory = new Map<string, string>();
export const memoryStorage: ICognitoStorage = {
  setItem: (key, value) => {
    memory.set(key, value);
  },
  getItem: (key) => memory.get(key) ?? null,
  removeItem: (key) => {
    memory.delete(key);
  },
  clear: () => {
    memory.clear();
  },
};

const LEGACY_KEY_PREFIX = "CognitoIdentityServiceProvider.";

// Removes tokens an earlier build cached in localStorage.
export function purgePersistedTokens(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(LEGACY_KEY_PREFIX)) stale.push(key);
    }
    for (const key of stale) window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable (private mode, blocked): nothing persisted there.
  }
}

// GB-F5-1: the refresh token (and the username it belongs to) is kept until
// sign-out so a reload or a new launch of the installed PWA restores the session
// with refreshSession() instead of texting a new code. Without it every app open
// cost an SMS and ran into the per-phone caps of the create-auth trigger
// (GB-R1-3). ID and access tokens are never written here; they live in memory
// and are minted again from the refresh token. Sign-out revokes the token at
// Cognito (RevokeToken) and deletes this entry.
export const SESSION_STORAGE_KEY = "gb:session";

export type SavedSession = { username: string; refreshToken: string };

export function saveSession(session: SavedSession): void {
  try {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ username: session.username, refreshToken: session.refreshToken }),
    );
  } catch {
    // Storage unavailable (private mode, blocked, full): the session stays
    // memory-only and the next launch asks for a code, as before.
  }
}

export function loadSession(): SavedSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as SavedSession).username === "string" &&
      typeof (parsed as SavedSession).refreshToken === "string" &&
      (parsed as SavedSession).username.length > 0 &&
      (parsed as SavedSession).refreshToken.length > 0
    ) {
      return {
        username: (parsed as SavedSession).username,
        refreshToken: (parsed as SavedSession).refreshToken,
      };
    }
  } catch {
    // Unreadable or corrupt: treat as signed out (and drop it below).
  }
  clearSavedSession();
  return null;
}

export function clearSavedSession(): void {
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Storage unavailable: nothing saved there.
  }
}

// True when Cognito refused the refresh token itself (expired, revoked, user
// gone), as opposed to a network or throttling failure worth retrying.
export function isSessionRejected(err: unknown): boolean {
  const e = err as { code?: unknown; name?: unknown } | null;
  const code = typeof e?.code === "string" ? e.code : typeof e?.name === "string" ? e.name : "";
  return (
    code === "NotAuthorizedException" ||
    code === "UserNotFoundException" ||
    code === "InvalidParameterException"
  );
}

let _pool: CognitoUserPool | null = null;
function pool(): CognitoUserPool {
  if (!_pool) {
    // Read on first use: /config.json (lib/runtime-config.ts) loads before render.
    const { userPoolId, clientId } = cognitoIds();
    if (!userPoolId || !clientId) {
      throw new Error(
        "Cognito not configured. Deploy writes /config.json; locally set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID.",
      );
    }
    const poolData: ICognitoUserPoolData = {
      UserPoolId: userPoolId,
      ClientId: clientId,
      Storage: memoryStorage,
    };
    _pool = new CognitoUserPool(poolData);
  }
  return _pool;
}

export type AuthTokens = {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

function tokensFromSession(session: CognitoUserSession): AuthTokens {
  const accessToken = session.getAccessToken();
  return {
    idToken: session.getIdToken().getJwtToken(),
    accessToken: accessToken.getJwtToken(),
    refreshToken: session.getRefreshToken().getToken(),
    expiresAt: accessToken.getExpiration() * 1000,
  };
}

export async function startSignIn(phoneE164: string): Promise<{ session: string }> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: phoneE164, Pool: pool(), Storage: memoryStorage });
    user.setAuthenticationFlowType("CUSTOM_AUTH");
    const details = new AuthenticationDetails({ Username: phoneE164 });
    user.initiateAuth(details, {
      onSuccess: () => resolve({ session: "" }),
      onFailure: (err) => reject(err),
      customChallenge: () => resolve({ session: "challenge" }),
    });
    cacheUser(phoneE164, user);
  });
}

const userCache = new Map<string, CognitoUser>();
function cacheUser(username: string, user: CognitoUser): void {
  userCache.set(username, user);
}

export async function confirmOtp(phoneE164: string, code: string): Promise<AuthTokens> {
  const user = userCache.get(phoneE164);
  if (!user) {
    throw new Error("Sign-in session expired. Start over.");
  }
  return new Promise((resolve, reject) => {
    user.sendCustomChallengeAnswer(code, {
      onSuccess: (session) => resolve(tokensFromSession(session as CognitoUserSession)),
      onFailure: (err) => reject(err),
    });
  });
}

export async function refreshSession(refreshToken: string, username: string): Promise<AuthTokens> {
  const user = new CognitoUser({ Username: username, Pool: pool(), Storage: memoryStorage });
  return new Promise((resolve, reject) => {
    user.refreshSession(
      // The lib expects a CognitoRefreshToken-like object
      { getToken: () => refreshToken } as never,
      (err: Error | null, session: CognitoUserSession) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(tokensFromSession(session));
      },
    );
  });
}

// Revokes the refresh token server-side (and the tokens minted from it), so a
// copy taken earlier stops working. Best effort: sign-out never waits on it.
async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const { userPoolId, clientId } = cognitoIds();
  const region = userPoolId.split("_")[0];
  if (!region || !clientId) return;
  await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.RevokeToken",
    },
    body: JSON.stringify({ Token: refreshToken, ClientId: clientId }),
  });
}

export function signOut(refreshToken?: string): void {
  if (refreshToken) void revokeRefreshToken(refreshToken).catch(() => undefined);
  try {
    pool().getCurrentUser()?.signOut();
  } catch {
    // Not configured: nothing cached.
  }
  userCache.clear();
  memory.clear();
  clearSavedSession();
  purgePersistedTokens();
}
