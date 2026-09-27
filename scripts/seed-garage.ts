#!/usr/bin/env tsx
/**
 * Seeds the initial Garage record + owner Membership in the deployed
 * DynamoDB table. Reads the table name from CloudFormation stack outputs
 * (`garageborrow-<stage>` → `TableName`); pass `--table` to override.
 *
 * Idempotent: if a Garage with the requested `--slug` already exists, the
 * script logs a message and exits 0 without writing.
 *
 * Usage:
 *   pnpm --filter @garageborrow/api exec tsx ../../scripts/seed-garage.ts \
 *     --name "Demo Garage" \
 *     --slug "demo-garage" \
 *     --owner-phone "+15555550100" \
 *     --city-slug "sample-town" \
 *     --city-display "Sample Town, ST" \
 *     --stage prod
 */

import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const REGION = "us-east-2";

interface Args {
  name: string;
  slug: string;
  ownerPhone: string;
  citySlug: string;
  cityDisplay: string;
  stage: string;
  table?: string;
  profile?: string;
}

function readArgs(): Args {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      slug: { type: "string" },
      "owner-phone": { type: "string" },
      "city-slug": { type: "string" },
      "city-display": { type: "string" },
      stage: { type: "string", default: "dev" },
      table: { type: "string" },
      profile: { type: "string" },
    },
  });
  const required = ["name", "slug", "owner-phone", "city-slug", "city-display"] as const;
  for (const key of required) {
    if (!values[key]) {
      console.error(`error: --${key} is required`);
      process.exit(1);
    }
  }
  if (!/^\+[1-9]\d{1,14}$/.test(values["owner-phone"] as string)) {
    console.error("error: --owner-phone must be E.164 (e.g. +15555550100)");
    process.exit(1);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.slug as string)) {
    console.error("error: --slug must be lowercase-kebab");
    process.exit(1);
  }
  return {
    name: values.name as string,
    slug: values.slug as string,
    ownerPhone: values["owner-phone"] as string,
    citySlug: values["city-slug"] as string,
    cityDisplay: values["city-display"] as string,
    stage: values.stage as string,
    ...(values.table ? { table: values.table } : {}),
    ...(values.profile ? { profile: values.profile } : {}),
  };
}

function lookupTableName(stage: string): string {
  // The SAM stack name is `garageborrow-<stage>`. The table name follows the
  // same pattern (`GarageBorrow-<stage>`); we still go through CloudFormation
  // so an upstream rename is picked up automatically.
  const stackName = `garageborrow-${stage}`;
  const out = execFileSync(
    "aws",
    [
      "cloudformation",
      "describe-stacks",
      "--region",
      REGION,
      "--stack-name",
      stackName,
      "--query",
      "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue | [0]",
      "--output",
      "text",
    ],
    { encoding: "utf8" },
  ).trim();
  if (!out || out === "None") {
    // Fall back to the conventional name; surfaces a clearer error if the
    // table truly doesn't exist than a silent DynamoDB ResourceNotFound.
    return `GarageBorrow-${stage === "prod" ? "prod" : "dev"}`;
  }
  return out;
}

async function main(): Promise<void> {
  const args = readArgs();
  if (args.profile) process.env.AWS_PROFILE = args.profile;

  const tableName = args.table ?? lookupTableName(args.stage);
  console.log(`→ table: ${tableName}`);

  const client = new DynamoDBClient({ region: REGION });
  const ddb = DynamoDBDocumentClient.from(client);

  const existing = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `TENANT#${args.slug}`, SK: "META" },
    }),
  );
  if (existing.Item) {
    console.log(`✓ garage '${args.slug}' already exists — nothing to do`);
    return;
  }

  const now = new Date().toISOString();
  const garage = {
    id: args.slug,
    name: args.name,
    owner_phone: args.ownerPhone,
    city_slug: args.citySlug,
    city_display: args.cityDisplay,
    geo: null,
    quality_tiers: ["good", "great", "perfect"],
    status: "open",
    payforward_orgs: [],
    ai_enabled: false,
    ai_min_tier: "family",
    ai_total_monthly_cap_cents: 500,
    ai_default_user_monthly_tokens: 100000,
    ai_default_model: "haiku",
    tier_labels: { howdy: "Howdy", friend: "Friend", family: "Family" },
    vouching_required: false,
    created_at: now,
    updated_at: now,
  };
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: { PK: `TENANT#${args.slug}`, SK: "META", ...garage },
      ConditionExpression: "attribute_not_exists(PK)",
    }),
  );
  console.log(`✓ created garage '${args.slug}' owned by ${args.ownerPhone}`);

  const membership = {
    garage_id: args.slug,
    user_phone: args.ownerPhone,
    tier: "family",
    joined_at: now,
    borrows_total: 0,
    borrows_active: 0,
    returns_on_time: 0,
    returns_late: 0,
    no_shows: 0,
    ai_tokens_used_this_month: 0,
    ai_tokens_used_total: 0,
    celebration_pending: false,
  };
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `TENANT#${args.slug}`,
        SK: `MEMBER#${args.ownerPhone}`,
        ...membership,
      },
    }),
  );
  console.log(`✓ created owner Membership (${args.ownerPhone}) at tier 'family'`);

  // The owner's profile row. /v1/me reads it (through GSI1), and POST
  // /v1/auth/start creates a Cognito account only for a phone that has a profile
  // or an invite, so this is what lets the owner sign in the first time.
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `TENANT#${args.slug}`,
        SK: `USER#${args.ownerPhone}`,
        GSI1PK: `USER#${args.ownerPhone}`,
        GSI1SK: `USER#${args.slug}`,
        phone: args.ownerPhone,
        display_name: "Owner",
        visibility: "visible",
        garages_member_of: [args.slug],
        notification_prefs: {
          sms_enabled: true,
          push_enabled: true,
          reminders: true,
          waitlist_updates: true,
          new_tools: true,
          promotion_celebrations: true,
          ai_ready_notify: false,
          quiet_hours_start: "21:00",
          quiet_hours_end: "08:00",
        },
        created_at: now,
        last_seen_at: now,
      },
      ConditionExpression: "attribute_not_exists(PK)",
    }),
  );
  console.log(
    `✓ created owner profile (${args.ownerPhone}); sign in with that number to create the account`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
