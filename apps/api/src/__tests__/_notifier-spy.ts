// Captures notifier invocations instead of sending them to Lambda.
import type { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

import { setLambdaClient } from "../lib/notify.js";
import type { NotifierEvent } from "../lib/notify.js";

export function spyNotifier(): NotifierEvent[] {
  const sent: NotifierEvent[] = [];
  const fake = {
    send: (cmd: InvokeCommand) => {
      const raw = cmd.input.Payload as Uint8Array;
      sent.push(JSON.parse(Buffer.from(raw).toString("utf8")) as NotifierEvent);
      return Promise.resolve({});
    },
  };
  setLambdaClient(fake as unknown as LambdaClient);
  return sent;
}

export function clearNotifierSpy(): void {
  setLambdaClient(undefined);
}
