import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { env } from "./env.js";

let cached: DynamoDBDocumentClient | undefined;

export function ddb(): DynamoDBDocumentClient {
  if (!cached) {
    const raw = new DynamoDBClient({ region: env.region() });
    cached = DynamoDBDocumentClient.from(raw, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertEmptyValues: false,
        convertClassInstanceToMap: false,
      },
    });
  }
  return cached;
}

// Tests inject a stub by replacing the singleton.
export function setDdb(client: DynamoDBDocumentClient): void {
  cached = client;
}
