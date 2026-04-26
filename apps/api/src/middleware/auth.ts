import type { Context, MiddlewareHandler, Next } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";

import { env } from "../lib/env.js";
import { ApiError } from "../lib/errors.js";
import type { AppEnv } from "../lib/types.js";

let jwks: JWTVerifyGetKey | undefined;

function getJwks(): JWTVerifyGetKey {
  if (!jwks) {
    const userPoolId = env.userPoolId();
    if (!userPoolId) {
      throw new ApiError("internal_error", "USER_POOL_ID not configured");
    }
    const issuer = `https://cognito-idp.${env.region()}.amazonaws.com/${userPoolId}`;
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  }
  return jwks;
}

// Allow tests to swap the verifier wholesale.
export type Verifier = (
  token: string,
) => Promise<{ phone: string; sub: string; clientId?: string }>;

let overrideVerifier: Verifier | undefined;

export function setAuthVerifier(v: Verifier | undefined): void {
  overrideVerifier = v;
}

async function defaultVerify(
  token: string,
): Promise<{ phone: string; sub: string; clientId?: string }> {
  const userPoolId = env.userPoolId();
  if (!userPoolId) throw new ApiError("internal_error", "USER_POOL_ID not configured");
  const issuer = `https://cognito-idp.${env.region()}.amazonaws.com/${userPoolId}`;
  const { payload } = await jwtVerify(token, getJwks(), { issuer });
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const username =
    typeof payload["cognito:username"] === "string" ? (payload["cognito:username"] as string) : "";
  const phoneClaim =
    typeof payload["phone_number"] === "string" ? (payload["phone_number"] as string) : username;
  if (!sub || !phoneClaim) {
    throw new ApiError("unauthorized", "Token missing required claims");
  }
  const expectedClient = env.cognitoClientId();
  const tokenClient =
    typeof payload["client_id"] === "string"
      ? (payload["client_id"] as string)
      : Array.isArray(payload.aud)
        ? payload.aud[0]
        : (payload.aud as string | undefined);
  if (expectedClient && tokenClient && tokenClient !== expectedClient) {
    throw new ApiError("unauthorized", "Token issued for a different client");
  }
  return tokenClient
    ? { phone: phoneClaim, sub, clientId: tokenClient }
    : { phone: phoneClaim, sub };
}

function bearerToken(c: Context<AppEnv>): string | undefined {
  const h = c.req.header("authorization") ?? c.req.header("Authorization");
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : undefined;
}

export function requireAuth(): MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next: Next) => {
    if (env.jwtBypass()) {
      const phone = c.req.header("x-test-phone") ?? "+15555550100";
      c.set("user", { phone, sub: `test-${phone}` });
      await next();
      return;
    }
    const token = bearerToken(c);
    if (!token) throw new ApiError("unauthorized", "Missing bearer token");
    const verifier = overrideVerifier ?? defaultVerify;
    let claims: { phone: string; sub: string };
    try {
      claims = await verifier(token);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError("unauthorized", "Invalid token");
    }
    c.set("user", { phone: claims.phone, sub: claims.sub });
    await next();
  };
}
