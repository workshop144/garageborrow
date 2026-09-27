// Account creation for the phone-only user pool. Self-service SignUp is closed
// (AdminCreateUserOnly), so the API creates the Cognito user for a phone that
// holds an owner's invite (or already has a profile), then the PWA runs the
// normal CUSTOM_AUTH SMS-code sign-in against it.
//
// phone_number_verified is set at creation: the only way to get tokens for this
// user is the SMS code sent to that number (custom auth, no password), and users
// cannot change their phone_number (the app client may write only `name`).

import { randomBytes } from "node:crypto";

import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";

import { env } from "./env.js";
import { ApiError } from "./errors.js";

// Returns true when a user was created, false when one already existed.
export type EnsureUser = (phone: string) => Promise<boolean>;

let override: EnsureUser | undefined;
let client: CognitoIdentityProviderClient | undefined;

export function setEnsureCognitoUser(fn: EnsureUser | undefined): void {
  override = fn;
}

function errName(err: unknown): string {
  return err && typeof err === "object" && "name" in err
    ? String((err as { name: unknown }).name)
    : "";
}

export async function ensureCognitoUser(phone: string): Promise<boolean> {
  if (override) return override(phone);
  const UserPoolId = env.userPoolId();
  if (!UserPoolId) throw new ApiError("internal_error", "USER_POOL_ID not configured");
  client ??= new CognitoIdentityProviderClient({ region: env.region() });
  try {
    await client.send(new AdminGetUserCommand({ UserPoolId, Username: phone }));
    return false;
  } catch (err) {
    if (errName(err) !== "UserNotFoundException") throw err;
  }
  try {
    await client.send(
      new AdminCreateUserCommand({
        UserPoolId,
        Username: phone,
        MessageAction: "SUPPRESS", // no welcome SMS: the sign-in code is the only text
        UserAttributes: [
          { Name: "phone_number", Value: phone },
          { Name: "phone_number_verified", Value: "true" },
        ],
      }),
    );
  } catch (err) {
    if (errName(err) === "UsernameExistsException") return false; // a concurrent start won
    throw err;
  }
  // AdminCreateUser leaves the user in FORCE_CHANGE_PASSWORD. A random permanent
  // password (never stored or shown; no password flow is enabled on the client)
  // moves it to CONFIRMED so CUSTOM_AUTH sign-in works.
  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId,
      Username: phone,
      Password: `${randomBytes(24).toString("base64url")}aA1!`,
      Permanent: true,
    }),
  );
  return true;
}
