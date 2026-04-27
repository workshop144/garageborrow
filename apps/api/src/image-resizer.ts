// Image-resizer Lambda: triggered on every S3 ObjectCreated in the images
// bucket. Generates a 256px thumbnail and a 1024px medium variant alongside
// the original under /thumb/<key> and /medium/<key>. Skips inputs whose key
// already lives under one of those prefixes so the function is idempotent
// (writing the resize result back into the same bucket would otherwise
// re-trigger us in an infinite loop).
//
// `sharp` is intentionally listed as an external in esbuild — at deploy
// time we ship it via the AWS Lambda layer published by the sharp authors
// rather than bundling the platform-specific binary into the function zip.

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";

import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { captureError, initSentry } from "./lib/sentry.js";

initSentry();

const THUMB_PREFIX = "thumb/";
const MEDIUM_PREFIX = "medium/";

let cached: S3Client | undefined;

function s3(): S3Client {
  if (!cached) cached = new S3Client({ region: env.region() });
  return cached;
}

export function setS3Client(c: S3Client | undefined): void {
  cached = c;
}

// Minimal subset of the sharp surface we use; the package is loaded
// dynamically inside resizeBuffer so test bundles don't need it.
type SharpFn = (input: Buffer) => SharpInstance;
interface SharpInstance {
  resize(opts: { width: number; height?: number; fit?: string }): SharpInstance;
  toBuffer(): Promise<Buffer>;
}

let cachedSharp: SharpFn | undefined;
async function loadSharp(): Promise<SharpFn> {
  if (cachedSharp) return cachedSharp;
  const mod = (await import("sharp")) as { default: SharpFn } | SharpFn;
  cachedSharp = typeof mod === "function" ? mod : (mod as { default: SharpFn }).default;
  return cachedSharp;
}

export function setSharpForTest(fn: SharpFn | undefined): void {
  cachedSharp = fn;
}

export interface S3EventRecord {
  s3: {
    bucket: { name: string };
    object: { key: string };
  };
}

export interface S3Event {
  Records: S3EventRecord[];
}

export function isResizedKey(key: string): boolean {
  // URL-decode the key first — S3 ObjectCreated events arrive URL-encoded
  // (spaces → "+", "/" stays "/"). Comparing the raw key would miss the
  // recursion guard for keys containing decoded characters.
  const decoded = safeDecode(key);
  return decoded.startsWith(THUMB_PREFIX) || decoded.startsWith(MEDIUM_PREFIX);
}

function safeDecode(key: string): string {
  try {
    return decodeURIComponent(key.replace(/\+/g, " "));
  } catch {
    return key;
  }
}

interface ResizeResult {
  thumb_key: string;
  medium_key: string;
}

export async function resizeOne(bucket: string, key: string): Promise<ResizeResult | null> {
  if (isResizedKey(key)) {
    logger.debug({ key }, "resizer_skip_already_resized");
    return null;
  }
  const decoded = safeDecode(key);
  const obj = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: decoded }));
  const body = await streamToBuffer(obj.Body as Readable | undefined);
  if (!body) {
    logger.warn({ key: decoded }, "resizer_empty_body");
    return null;
  }
  const sharp = await loadSharp();
  const [thumb, medium] = await Promise.all([
    sharp(body).resize({ width: 256, fit: "inside" }).toBuffer(),
    sharp(body).resize({ width: 1024, fit: "inside" }).toBuffer(),
  ]);
  const thumbKey = `${THUMB_PREFIX}${decoded}`;
  const mediumKey = `${MEDIUM_PREFIX}${decoded}`;
  const contentType = obj.ContentType ?? "application/octet-stream";
  await Promise.all([
    s3().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: thumbKey,
        Body: thumb,
        ContentType: contentType,
      }),
    ),
    s3().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: mediumKey,
        Body: medium,
        ContentType: contentType,
      }),
    ),
  ]);
  logger.info({ key: decoded, thumb: thumbKey, medium: mediumKey }, "resizer_ok");
  return { thumb_key: thumbKey, medium_key: mediumKey };
}

async function streamToBuffer(stream: Readable | undefined): Promise<Buffer | undefined> {
  if (!stream) return undefined;
  const chunks: Buffer[] = [];
  // The S3 stream is an AsyncIterable<Buffer | Uint8Array>; iterate to
  // accumulate. Avoid stream events to keep this dependency-free.
  for await (const chunk of stream) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function handler(event: S3Event): Promise<{ processed: number }> {
  let processed = 0;
  for (const rec of event.Records ?? []) {
    const bucket = rec.s3?.bucket?.name;
    const key = rec.s3?.object?.key;
    if (!bucket || !key) continue;
    try {
      const result = await resizeOne(bucket, key);
      if (result) processed++;
    } catch (err) {
      logger.warn({ err, key }, "resizer_failed");
      captureError(err, { bucket, key });
    }
  }
  return { processed };
}
