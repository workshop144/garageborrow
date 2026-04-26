import { S3Client } from "@aws-sdk/client-s3";

import { env } from "./env.js";

let cached: S3Client | undefined;

export function s3(): S3Client {
  if (!cached) {
    cached = new S3Client({ region: env.region() });
  }
  return cached;
}
