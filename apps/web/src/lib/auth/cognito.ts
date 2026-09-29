import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  type CognitoUserSession,
  type ICognitoStorage,
  type ICognitoUserPoolData,
} from "amazon-cognito-identity-js";

const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID ?? "";
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID ?? "";

// The session lives only in React state (a reload signs you out), so the
// library's token cache must not outlive the page either. Its default is
// window.localStorage, which would keep a 30-day refresh token on the device
// after the app shows the user signed out.
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

const poolData: ICognitoUserPoolData = {
  UserPoolId: userPoolId,
  ClientId: clientId,
  Storage: memoryStorage,
};

let _pool: CognitoUserPool | null = null;
function pool(): CognitoUserPool {
  if (!_pool) {
    if (!userPoolId || !clientId) {
      throw new Error(
        "Cognito not configured. Set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID.",
      );
    }
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
  purgePersistedTokens();
}
