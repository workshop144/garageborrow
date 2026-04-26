import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";

import { env } from "./env.js";

let cached: SESClient | undefined;

function ses(): SESClient {
  if (!cached) cached = new SESClient({ region: env.region() });
  return cached;
}

export async function sendDataExportEmail(opts: {
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  await ses().send(
    new SendEmailCommand({
      Source: env.sesFromAddress(),
      Destination: { ToAddresses: [opts.to] },
      Message: {
        Subject: { Data: opts.subject },
        Body: { Text: { Data: opts.body } },
      },
    }),
  );
}
