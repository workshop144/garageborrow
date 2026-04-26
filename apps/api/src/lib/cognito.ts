// Direct call to Cognito's InitiateAuth (CUSTOM_AUTH) over HTTPS. This is
// the same unauthenticated client API the front-end uses via
// amazon-cognito-identity-js, but we trigger it server-side so we can gate
// resends with our own rate limit before Cognito's quotas kick in.
//
// CUSTOM_AUTH InitiateAuth doesn't require SigV4 signing for public clients
// (no client secret), so a plain fetch suffices and we avoid pulling in the
// cognito SDK.

import { env } from "./env.js";
import { ApiError } from "./errors.js";

export type ResendTrigger = (phone: string) => Promise<void>;

let override: ResendTrigger | undefined;

export function setOtpResendTrigger(t: ResendTrigger | undefined): void {
  override = t;
}

export async function triggerOtpResend(phone: string): Promise<void> {
  if (override) {
    return override(phone);
  }
  const region = env.region();
  const clientId = env.cognitoClientId();
  if (!clientId) {
    throw new ApiError("internal_error", "COGNITO_CLIENT_ID not configured");
  }
  const url = `https://cognito-idp.${region}.amazonaws.com/`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({
      AuthFlow: "CUSTOM_AUTH",
      ClientId: clientId,
      AuthParameters: { USERNAME: phone },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError("internal_error", `Cognito resend failed: ${res.status} ${text}`);
  }
}
