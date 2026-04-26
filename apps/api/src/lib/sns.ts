import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";

import { env } from "./env.js";

let cached: SNSClient | undefined;

function sns(): SNSClient {
  if (!cached) cached = new SNSClient({ region: env.region() });
  return cached;
}

export async function sendSms(phone: string, message: string): Promise<void> {
  await sns().send(
    new PublishCommand({
      PhoneNumber: phone,
      Message: message,
    }),
  );
}
