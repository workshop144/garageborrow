#!/usr/bin/env tsx
/**
 * One-off: moves photos uploaded before PR #17 off object keys that embed the
 * uploader's phone number (uploads/<kind>/<phone>/<id>.<ext>, plus the thumb/
 * and medium/ copies) onto the opaque form (uploads/<kind>/<id>.<ext>), and
 * repoints every table row that names them. Logic and tests:
 * apps/api/src/lib/photo-key-migration.ts.
 *
 * Dry run by default (counts only, writes nothing). Idempotent: rerunning after
 * a partial or complete run finishes the job or does nothing. Old objects are
 * deleted only after no row names them any more.
 *
 * Pre-production stages only: `prod` is refused. Output never contains a phone
 * number (keys are printed redacted).
 *
 * Usage (from apps/api, so the AWS SDK resolves):
 *   pnpm dlx tsx@4 ../../scripts/migrate-photo-keys.ts --stage dev
 *   pnpm dlx tsx@4 ../../scripts/migrate-photo-keys.ts --stage dev --apply
 */

import { parseArgs } from "node:util";

import { migratePhotoKeys } from "../apps/api/src/lib/photo-key-migration.js";

const REGION = "us-east-2";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      stage: { type: "string" },
      apply: { type: "boolean", default: false },
    },
  });
  const stage = values.stage;
  if (!stage || !/^[a-z0-9-]+$/.test(stage)) {
    throw new Error("--stage <name> is required (e.g. dev)");
  }
  if (stage === "prod" || stage === "production") {
    throw new Error("refusing to run against production");
  }
  // Read by the api's S3 and DynamoDB clients.
  process.env["AWS_REGION"] ??= REGION;
  // Names follow infra/template.yaml.
  const table = `GarageBorrow-${stage}`;
  const bucket = `garageborrow-images-${stage}`;
  const report = await migratePhotoKeys({
    bucket,
    table,
    apply: values.apply ?? false,
  });
  console.log(JSON.stringify({ stage, apply: values.apply ?? false, ...report }, null, 2));
  if (report.rows_gave_up > 0 || report.rows_still_referencing > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
