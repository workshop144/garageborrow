// requireAuth with the real verifier: tokens are signed with a locally
// generated key and the Cognito JWKS endpoint is a stubbed fetch, so this
// checks signature, issuer and claim handling without any network.

import { Hono } from "hono";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey, JWK } from "jose";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "../lib/types.js";
import { onError } from "../middleware/error.js";
import { requireAuth, setAuthVerifier } from "../middleware/auth.js";

const ISSUER = "https://cognito-idp.us-east-2.amazonaws.com/us-east-2_TEST";
const PHONE = "+15555550177";
let signingKey: CryptoKey;
let otherKey: CryptoKey;
let publicJwk: JWK;
const fetchSpy = vi.fn();

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  otherKey = (await generateKeyPair("RS256")).privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  fetchSpy.mockImplementation((url: unknown) => {
    const href = url instanceof URL ? url.href : String(url);
    if (href !== `${ISSUER}/.well-known/jwks.json`) {
      return Promise.reject(new Error(`unexpected fetch ${href}`));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ keys: [publicJwk] }), {
        headers: { "content-type": "application/json" },
      }),
    );
  });
  vi.stubGlobal("fetch", fetchSpy);
  setAuthVerifier(undefined);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  delete process.env["JWT_BYPASS"];
  process.env["STAGE"] = "test";
});

function app(): Hono<AppEnv> {
  const a = new Hono<AppEnv>();
  a.onError(onError);
  a.get("/who", requireAuth(), (c) => c.json(c.get("user")));
  return a;
}

async function token(
  claims: Record<string, unknown> = {},
  opts: { key?: CryptoKey; issuer?: string; exp?: string | number } = {},
): Promise<string> {
  return new SignJWT({
    token_use: "id",
    phone_number: PHONE,
    phone_number_verified: true,
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setSubject("sub-177")
    .setAudience("test-client")
    .setIssuer(opts.issuer ?? ISSUER)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "1h")
    .sign(opts.key ?? signingKey);
}

function get(headers: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve(app().request("/who", { headers }));
}

describe("requireAuth with the Cognito JWKS verifier", () => {
  it("accepts a correctly signed ID token and exposes the verified phone", async () => {
    const res = await get({ Authorization: `Bearer ${await token()}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ phone: PHONE, sub: "sub-177" });
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("accepts a lower-case bearer scheme", async () => {
    const res = await get({ Authorization: `bearer ${await token()}` });
    expect(res.status).toBe(200);
  });

  it("rejects a token signed by a different key", async () => {
    const res = await get({ Authorization: `Bearer ${await token({}, { key: otherKey })}` });
    expect(res.status).toBe(401);
  });

  it("rejects a token from another issuer (another user pool)", async () => {
    const t = await token({}, { issuer: "https://cognito-idp.us-east-2.amazonaws.com/other" });
    expect((await get({ Authorization: `Bearer ${t}` })).status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const t = await token({}, { exp: Math.floor(Date.now() / 1000) - 60 });
    expect((await get({ Authorization: `Bearer ${t}` })).status).toBe(401);
  });

  it("rejects an access token even when correctly signed", async () => {
    const t = await token({ token_use: "access" });
    const res = await get({ Authorization: `Bearer ${t}` });
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).toContain("ID token");
  });

  it("rejects a token issued to another app client", async () => {
    const t = await new SignJWT({
      token_use: "id",
      phone_number: PHONE,
      phone_number_verified: true,
    })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setSubject("sub-177")
      .setAudience("someone-elses-client")
      .setIssuer(ISSUER)
      .setExpirationTime("1h")
      .sign(signingKey);
    expect((await get({ Authorization: `Bearer ${t}` })).status).toBe(401);
  });

  it("rejects a garbage token and a non-bearer scheme", async () => {
    expect((await get({ Authorization: "Bearer not.a.jwt" })).status).toBe(401);
    expect((await get({ Authorization: `Basic ${await token()}` })).status).toBe(401);
    expect((await get()).status).toBe(401);
  });

  it("ignores x-test-phone when JWT_BYPASS is not set", async () => {
    const res = await get({ "x-test-phone": "+15555550199" });
    expect(res.status).toBe(401);
  });
});

describe("JWT_BYPASS", () => {
  it("trusts x-test-phone on a non-prod stage (local development)", async () => {
    process.env["JWT_BYPASS"] = "1";
    process.env["STAGE"] = "dev";
    const res = await get({ "x-test-phone": "+15555550199" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ phone: "+15555550199", sub: "test-+15555550199" });
  });

  // Bug fix (tests/coverage-2026-11-06c): the bypass used to be honoured on any
  // stage, so JWT_BYPASS=1 on a prod Lambda let anyone act as any phone.
  it("is ignored on the prod stage", async () => {
    process.env["JWT_BYPASS"] = "1";
    process.env["STAGE"] = "prod";
    const res = await get({ "x-test-phone": "+15555550199" });
    expect(res.status).toBe(401);
  });
});
