// ensureCognitoUser: the only place the API creates Cognito users. The SDK
// client is replaced with aws-sdk-client-mock, so nothing reaches AWS.

import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureCognitoUser, setEnsureCognitoUser } from "../lib/cognito.js";

const PHONE = "+15555550142";
const cognito = mockClient(CognitoIdentityProviderClient);

function named(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

beforeEach(() => {
  cognito.reset();
  setEnsureCognitoUser(undefined);
});

afterEach(() => {
  process.env["USER_POOL_ID"] = "us-east-2_TEST";
});

describe("ensureCognitoUser", () => {
  it("returns false and creates nothing when the user already exists", async () => {
    cognito.on(AdminGetUserCommand).resolves({ Username: PHONE });
    await expect(ensureCognitoUser(PHONE, true)).resolves.toBe(false);
    expect(cognito.commandCalls(AdminCreateUserCommand)).toHaveLength(0);
    expect(cognito.commandCalls(AdminSetUserPasswordCommand)).toHaveLength(0);
  });

  it("creates a verified-phone user with no welcome SMS, then confirms it", async () => {
    cognito.on(AdminGetUserCommand).rejects(named("UserNotFoundException"));
    cognito.on(AdminCreateUserCommand).resolves({});
    cognito.on(AdminSetUserPasswordCommand).resolves({});

    await expect(ensureCognitoUser(PHONE, true)).resolves.toBe(true);

    const create = cognito.commandCalls(AdminCreateUserCommand)[0]?.args[0].input;
    expect(create).toMatchObject({
      UserPoolId: "us-east-2_TEST",
      Username: PHONE,
      MessageAction: "SUPPRESS",
    });
    expect(create?.UserAttributes).toEqual([
      { Name: "phone_number", Value: PHONE },
      { Name: "phone_number_verified", Value: "true" },
    ]);

    const pw = cognito.commandCalls(AdminSetUserPasswordCommand)[0]?.args[0].input;
    expect(pw?.Permanent).toBe(true);
    expect(pw?.Username).toBe(PHONE);
    // Random, long, and never derived from the phone.
    expect(pw?.Password?.length).toBeGreaterThanOrEqual(32);
    expect(pw?.Password).not.toContain(PHONE.slice(1));
  });

  it("uses a different random password for each new user", async () => {
    cognito.on(AdminGetUserCommand).rejects(named("UserNotFoundException"));
    cognito.on(AdminCreateUserCommand).resolves({});
    cognito.on(AdminSetUserPasswordCommand).resolves({});
    await ensureCognitoUser(PHONE, true);
    await ensureCognitoUser("+15555550143", true);
    const [a, b] = cognito
      .commandCalls(AdminSetUserPasswordCommand)
      .map((c) => c.args[0].input.Password);
    expect(a).toBeDefined();
    expect(a).not.toBe(b);
  });

  it("treats a concurrent create (UsernameExistsException) as already existing", async () => {
    cognito.on(AdminGetUserCommand).rejects(named("UserNotFoundException"));
    cognito.on(AdminCreateUserCommand).rejects(named("UsernameExistsException"));
    await expect(ensureCognitoUser(PHONE, true)).resolves.toBe(false);
    expect(cognito.commandCalls(AdminSetUserPasswordCommand)).toHaveLength(0);
  });

  it("rethrows any other lookup error instead of creating a user", async () => {
    cognito.on(AdminGetUserCommand).rejects(named("TooManyRequestsException"));
    await expect(ensureCognitoUser(PHONE, true)).rejects.toThrow("TooManyRequestsException");
    expect(cognito.commandCalls(AdminCreateUserCommand)).toHaveLength(0);
  });

  it("rethrows a non-duplicate create error and does not set a password", async () => {
    cognito.on(AdminGetUserCommand).rejects(named("UserNotFoundException"));
    cognito.on(AdminCreateUserCommand).rejects(named("InvalidParameterException"));
    await expect(ensureCognitoUser(PHONE, true)).rejects.toThrow("InvalidParameterException");
    expect(cognito.commandCalls(AdminSetUserPasswordCommand)).toHaveLength(0);
  });

  it("still looks the user up when it may not create one, and creates nothing (GB-F5-2)", async () => {
    cognito.on(AdminGetUserCommand).rejects(named("UserNotFoundException"));
    await expect(ensureCognitoUser(PHONE, false)).resolves.toBe(false);
    expect(cognito.commandCalls(AdminGetUserCommand)).toHaveLength(1);
    expect(cognito.commandCalls(AdminCreateUserCommand)).toHaveLength(0);
    expect(cognito.commandCalls(AdminSetUserPasswordCommand)).toHaveLength(0);
  });

  it("looks up an existing user the same way whether or not it may create", async () => {
    cognito.on(AdminGetUserCommand).resolves({ Username: PHONE });
    await expect(ensureCognitoUser(PHONE, false)).resolves.toBe(false);
    await expect(ensureCognitoUser(PHONE, true)).resolves.toBe(false);
    expect(cognito.commandCalls(AdminGetUserCommand)).toHaveLength(2);
    expect(cognito.commandCalls(AdminCreateUserCommand)).toHaveLength(0);
  });

  it("fails with internal_error when USER_POOL_ID is not configured", async () => {
    delete process.env["USER_POOL_ID"];
    await expect(ensureCognitoUser(PHONE, true)).rejects.toMatchObject({ code: "internal_error" });
    expect(cognito.calls()).toHaveLength(0);
  });

  it("defers to the test override when one is installed", async () => {
    const seen: string[] = [];
    setEnsureCognitoUser((p) => {
      seen.push(p);
      return Promise.resolve(true);
    });
    await expect(ensureCognitoUser(PHONE, true)).resolves.toBe(true);
    expect(seen).toEqual([PHONE]);
    expect(cognito.calls()).toHaveLength(0);
  });
});
