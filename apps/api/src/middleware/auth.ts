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

// Identity is the verified phone number from a Cognito ID token. Access tokens carry
// no phone claim (their `username` is the sub, since phone is the username
// attribute), and an unverified phone_number is one the user set but never proved.
export function claimsFromPayload(
  payload: Record<string, unknown>,
  expectedClient: string | undefined,
): { phone: string; sub: string; clientId?: string } {
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const phone = typeof payload["phone_number"] === "string" ? payload["phone_number"] : "";
  if (payload["token_use"] !== "id") {
    throw new ApiError("unauthorized", "An ID token is required");
  }
  if (!sub || !phone || payload["phone_number_verified"] !== true) {
    throw new ApiError("unauthorized", "Token missing a verified phone number");
  }
  const aud = payload.aud;
  const tokenClient = Array.isArray(aud) ? (aud[0] as string | undefined) : (aud as string | undefined);
  if (!tokenClient || (expectedClient && tokenClient !== expectedClient)) {
    throw new ApiError("unauthorized", "Token issued for a different client");
  }
  return { phone, sub, clientId: tokenClient };
}

async function defaultVerify(
  token: string,
): Promise<{ phone: string; sub: string; clientId?: string }> {
  const userPoolId = env.userPoolId();
  if (!userPoolId) throw new ApiError("internal_error", "USER_POOL_ID not configured");
  const issuer = `https://cognito-idp.${env.region()}.amazonaws.com/${userPoolId}`;
  const { payload } = await jwtVerify(token, getJwks(), { issuer });
  return claimsFromPayload(payload, env.cognitoClientId());
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
