import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  type CognitoUserSession,
  type ICognitoUserPoolData,
} from "amazon-cognito-identity-js";

const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID ?? "";
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID ?? "";

const poolData: ICognitoUserPoolData = {
  UserPoolId: userPoolId,
  ClientId: clientId,
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
    const user = new CognitoUser({ Username: phoneE164, Pool: pool() });
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
  const user = new CognitoUser({ Username: username, Pool: pool() });
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

export function signOut(): void {
  const current = pool().getCurrentUser();
  current?.signOut();
  userCache.clear();
}
