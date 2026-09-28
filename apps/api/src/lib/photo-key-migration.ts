// Photo object keys written before PR #17 embedded the uploader's phone:
//   uploads/<kind>/<phone digits>/<id>.<ext>
// (plus the resizer's thumb/… and medium/… copies of each). The current form is
//   uploads/<kind>/<id>.<ext>
// These helpers find old keys, map each to its opaque form (drop the phone
// segment; the <id> is already random), and rewrite every copy of an old key
// inside a table row: primary_photo_key, photo_keys, photo_url, audit snapshots.
// Used by scripts/migrate-photo-keys.ts.

import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  type S3Client,
} from "@aws-sdk/client-s3";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";

import { ddb } from "./ddb.js";
import { s3 as defaultS3 } from "./s3.js";
import { rewriteRow, type Row } from "./row-rewrite.js";

const KIND = "(?:tool_photo|donation_photo|wishlist_photo)";
// The phone segment is 7-15 digits (E.164 without "+"); the id after it is not.
const PHONE_SEGMENT = `(uploads/${KIND}/)\\d{7,15}/`;

export function hasPhoneSegment(key: string): boolean {
  return new RegExp(PHONE_SEGMENT).test(key);
}

export function migratedKey(key: string): string {
  return key.replace(new RegExp(PHONE_SEGMENT, "g"), "$1");
}

// Every string in the value with its old-format keys rewritten; other values as is.
export function rewritePhotoKeys(value: unknown): unknown {
  if (typeof value === "string") return hasPhoneSegment(value) ? migratedKey(value) : value;
  if (Array.isArray(value)) return value.map(rewritePhotoKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewritePhotoKeys(v)]));
  }
  return value;
}

export function mentionsOldKey(value: unknown): boolean {
  return hasPhoneSegment(JSON.stringify(value));
}

// --- the migration itself (dry run unless `apply`) ---------------------------------------

export interface MigrationReport {
  old_objects: number;
  objects_copied: number;
  rows_referencing: number;
  rows_rewritten: number;
  rows_gave_up: number;
  rows_still_referencing: number;
  objects_deleted: number;
}

async function listKeys(s3: S3Client, bucket: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ...(token ? { ContinuationToken: token } : {}),
      }),
    );
    for (const o of r.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function scanRows(table: string): Promise<Row[]> {
  const rows: Row[] = [];
  let last: Record<string, unknown> | undefined;
  do {
    const r = await ddb().send(
      new ScanCommand({ TableName: table, ...(last ? { ExclusiveStartKey: last } : {}) }),
    );
    rows.push(...((r.Items ?? []) as Row[]));
    last = r.LastEvaluatedKey;
  } while (last);
  return rows;
}

// Idempotent. Order matters: copy every old object to its new key, point every
// row at the new keys, confirm no row still names an old key, and only then
// delete the old objects. Stopping at any step leaves every reference valid.
export async function migratePhotoKeys(opts: {
  s3?: S3Client;
  bucket: string;
  table: string;
  apply: boolean;
}): Promise<MigrationReport> {
  const { bucket, table, apply } = opts;
  const s3 = opts.s3 ?? defaultS3();
  const report: MigrationReport = {
    old_objects: 0,
    objects_copied: 0,
    rows_referencing: 0,
    rows_rewritten: 0,
    rows_gave_up: 0,
    rows_still_referencing: 0,
    objects_deleted: 0,
  };

  const keys = await listKeys(s3, bucket);
  const present = new Set(keys);
  const old = keys.filter(hasPhoneSegment);
  report.old_objects = old.length;
  for (const key of old) {
    const target = migratedKey(key);
    if (present.has(target)) continue;
    if (apply) {
      await s3.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: target,
          CopySource: `${bucket}/${encodeURIComponent(key).replace(/%2F/g, "/")}`,
          MetadataDirective: "COPY",
        }),
      );
      present.add(target);
    }
    report.objects_copied++;
  }

  const referencing = (await scanRows(table)).filter(mentionsOldKey);
  report.rows_referencing = referencing.length;
  if (!apply) return report;

  for (const snapshot of referencing) {
    const outcome = await rewriteRow({
      table,
      snapshot,
      transform: (row) => (mentionsOldKey(row) ? (rewritePhotoKeys(row) as Row) : null),
    });
    if (outcome === "written") report.rows_rewritten++;
    if (outcome === "gave_up") report.rows_gave_up++;
  }

  report.rows_still_referencing = (await scanRows(table)).filter(mentionsOldKey).length;
  if (report.rows_still_referencing > 0) return report; // keep the old objects: still in use

  for (let i = 0; i < old.length; i += 1000) {
    const batch = old.slice(i, i + 1000);
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    report.objects_deleted += batch.length;
  }
  return report;
}
