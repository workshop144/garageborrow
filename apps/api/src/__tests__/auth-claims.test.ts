import { describe, expect, it } from "vitest";

import { claimsFromPayload } from "../middleware/auth.js";

const CLIENT = "client-123";
const idToken = {
  token_use: "id",
  sub: "0f9c-sub",
  aud: CLIENT,
  phone_number: "+15555550100",
  phone_number_verified: true,
};

describe("claimsFromPayload", () => {
  it("accepts an ID token with a verified phone for our client", () => {
    expect(claimsFromPayload(idToken, CLIENT)).toEqual({
      phone: "+15555550100",
      sub: "0f9c-sub",
      clientId: CLIENT,
    });
  });

  it("rejects an unverified phone_number (a user-set, unproven number)", () => {
    expect(() => claimsFromPayload({ ...idToken, phone_number_verified: false }, CLIENT)).toThrow(
      /verified phone/,
    );
  });

  it("rejects an access token, even one whose username looks like a phone", () => {
    const access = {
      token_use: "access",
      sub: "0f9c-sub",
      client_id: CLIENT,
      username: "+15555550100",
      "cognito:username": "+15555550100",
    };
    expect(() => claimsFromPayload(access, CLIENT)).toThrow(/ID token/);
  });

  it("rejects an ID token issued to another client", () => {
    expect(() => claimsFromPayload({ ...idToken, aud: "other" }, CLIENT)).toThrow(/different client/);
  });
});
