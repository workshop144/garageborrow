// Thin DynamoDB access layer. Each function takes the document client so
// callers (and tests) can swap the singleton, and returns plain objects
// matching the shared schemas. Higher-level routes own validation.

import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  donationKey,
  gsi1LoanByUser,
  gsi1ReservationByUser,
  incidentKey,
  instanceKey,
  itemKey,
  loanKey,
  notificationKey,
  pushSubscriptionKey,
  reservationKey,
  tenantMemberKey,
  tenantMetaKey,
  tenantUserKey,
  waitlistKey,
} from "@garageborrow/shared";
import type {
  DonationOffer,
  Garage,
  GarageMembership,
  IncidentReport,
  Instance,
  Item,
  Loan,
  Notification,
  PushSubscription,
  Reservation,
  User,
  WaitlistEntry,
} from "@garageborrow/shared";

import { ddb } from "./ddb.js";
import { env } from "./env.js";

type Stored<T> = T & { PK: string; SK: string };

function table(): string {
  return env.tableName();
}

function withKey<T>(key: { pk: string; sk: string }, data: T): Stored<T> {
  return { ...data, PK: key.pk, SK: key.sk };
}

// ─────────────────────────── Garage ───────────────────────────

export async function getGarage(garage_id: string): Promise<Garage | undefined> {
  const k = tenantMetaKey(garage_id);
  const r = await ddb().send(new GetCommand({ TableName: table(), Key: { PK: k.pk, SK: k.sk } }));
  return r.Item as Garage | undefined;
}

export async function putGarage(g: Garage): Promise<void> {
  const k = tenantMetaKey(g.id);
  await ddb().send(new PutCommand({ TableName: table(), Item: withKey(k, g) }));
}

// ─────────────────────────── User ─────────────────────────────

export async function getUser(garage_id: string, phone: string): Promise<User | undefined> {
  const k = tenantUserKey(garage_id, phone);
  const r = await ddb().send(new GetCommand({ TableName: table(), Key: { PK: k.pk, SK: k.sk } }));
  return r.Item as User | undefined;
}

export async function putUser(garage_id: string, u: User): Promise<void> {
  const k = tenantUserKey(garage_id, u.phone);
  await ddb().send(new PutCommand({ TableName: table(), Item: withKey(k, u) }));
}

export async function getUserAnyGarage(phone: string): Promise<User | undefined> {
  // Users are duplicated per tenant; for /v1/me we look up via the phone in
  // every garage they belong to. The "primary" record is whichever returns
  // first. Callers should subsequently fan out by garages_member_of.
  const r = await ddb().send(
    new QueryCommand({
      TableName: table(),
      IndexName: "byUser",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": `USER#${phone}` },
      Limit: 1,
    }),
  );
  return r.Items?.[0] as User | undefined;
}

// ─────────────────────────── Membership ───────────────────────

export async function getMembership(
  garage_id: string,
  phone: string,
): Promise<GarageMembership | undefined> {
  const k = tenantMemberKey(garage_id, phone);
  const r = await ddb().send(new GetCommand({ TableName: table(), Key: { PK: k.pk, SK: k.sk } }));
  return r.Item as GarageMembership | undefined;
}

export async function putMembership(m: GarageMembership): Promise<void> {
  const k = tenantMemberKey(m.garage_id, m.user_phone);
  await ddb().send(new PutCommand({ TableName: table(), Item: withKey(k, m) }));
}

export async function listMembers(garage_id: string): Promise<GarageMembership[]> {
  const r = await ddb().send(
    new QueryCommand({
      TableName: table(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `TENANT#${garage_id}`,
        ":sk": "MEMBER#",
      },
    }),
  );
  return (r.Items ?? []) as GarageMembership[];
}

export async function bumpMemberCounter(
  garage_id: string,
  phone: string,
  field: keyof Pick<
    GarageMembership,
    | "borrows_total"
    | "borrows_active"
    | "returns_on_time"
    | "returns_late"
    | "no_shows"
    | "ai_tokens_used_this_month"
    | "ai_tokens_used_total"
  >,
  delta: number,
): Promise<void> {
  const k = tenantMemberKey(garage_id, phone);
  await ddb().send(
    new UpdateCommand({
      TableName: table(),
      Key: { PK: k.pk, SK: k.sk },
      UpdateExpression: "ADD #f :delta",
      ExpressionAttributeNames: { "#f": field },
      ExpressionAttributeValues: { ":delta": delta },
    }),
  );
}

// ─────────────────────────── Item ─────────────────────────────

export async function getItem(garage_id: string, item_id: string): Promise<Item | undefined> {
  const k = itemKey(garage_id, item_id);
  const r = await ddb().send(new GetCommand({ TableName: table(), Key: { PK: k.pk, SK: k.sk } }));
  return r.Item as Item | undefined;
}

export async function putItem(item: Item): Promise<void> {
  const k = itemKey(item.garage_id, item.id);
  await ddb().send(new PutCommand({ TableName: table(), Item: withKey(k, item) }));
}

export async function listItems(garage_id: string): Promise<Item[]> {
  const r = await ddb().send(
    new QueryCommand({
      TableName: table(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `TENANT#${garage_id}`,
        ":sk": "ITEM#",
      },
    }),
  );
  // Filter to only top-level item records (SK = ITEM#<id>, no further #).
  return (r.Items ?? []).filter(
    (it) => typeof it["SK"] === "string" && (it["SK"] as string).split("#").length === 2,
  ) as Item[];
}

export async function listInstances(garage_id: string, item_id: string): Promise<Instance[]> {
  const r = await ddb().send(
    new QueryCommand({
      TableName: table(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `TENANT#${garage_id}`,
        ":sk": `ITEM#${item_id}#INST#`,
      },
    }),
  );
  return (r.Items ?? []) as Instance[];
}

export async function listAllInstancesInGarage(garage_id: string): Promise<Instance[]> {
  // Single query for all ITEM# records, partition out the instance rows
  // (SK = ITEM#<item_id>#INST#<instance_id>, four `#`-segments).
  const r = await ddb().send(
    new QueryCommand({
      TableName: table(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `TENANT#${garage_id}`,
        ":sk": "ITEM#",
      },
    }),
  );
  return (r.Items ?? []).filter(
    (it) => typeof it["SK"] === "string" && (it["SK"] as string).split("#").length === 4,
  ) as Instance[];
}

export async function putInstance(inst: Instance): Promise<void> {
  const k = instanceKey(inst.garage_id, inst.item_id, inst.id);
  await ddb().send(new PutCommand({ TableName: table(), Item: withKey(k, inst) }));
}

// ─────────────────────────── Loan ─────────────────────────────

export async function putLoan(loan: Loan): Promise<void> {
  const k = loanKey(loan.garage_id, loan.borrowed_at.slice(0, 10), loan.id);
  const gsi = gsi1LoanByUser(loan.borrower_phone, loan.borrowed_at);
  await ddb().send(
    new PutCommand({
      TableName: table(),
      Item: { ...loan, PK: k.pk, SK: k.sk, ...gsi },
    }),
  );
}

export async function listLoansByGarage(garage_id: string): Promise<Loan[]> {
  const r = await ddb().send(
    new QueryCommand({
      TableName: table(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `TENANT#${garage_id}`,
        ":sk": "LOAN#",
      },
    }),
  );
  return (r.Items ?? []) as Loan[];
}

export async function getLoan(garage_id: string, loan_id: string): Promise<Loan | undefined> {
  // Loans are scattered across LOAN#<date>#<id>; we have no direct date here,
  // so query the date prefix and filter. Production callers know the date.
  const r = await ddb().send(
    new QueryCommand({
      TableName: table(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `TENANT#${garage_id}`,
        ":sk": "LOAN#",
      },
    }),
  );
  return ((r.Items ?? []) as Loan[]).find((l) => l.id === loan_id);
}

export async function updateLoan(loan: Loan): Promise<void> {
  await putLoan(loan);
}

export async function listOverdueAutoConfirm(
  garage_id: string,
  cutoffIso: string,
): Promise<Loan[]> {
  const r = await ddb().send(
    new QueryCommand({
      TableName: table(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      FilterExpression:
        "#status = :active AND attribute_exists(return_claimed_at) AND return_claimed_at < :cutoff",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":pk": `TENANT#${garage_id}`,
        ":sk": "LOAN#",
        ":active": "active",
        ":cutoff": cutoffIso,
      },
    }),
  );
  return (r.Items ?? []) as Loan[];
}

// ─────────────────────────── Reservation ──────────────────────

export async function putReservation(r: Reservation): Promise<void> {
  const k = reservationKey(r.garage_id, r.start_at.slice(0, 10), r.id);
  const gsi = gsi1ReservationByUser(r.borrower_phone, r.start_at);
  await ddb().send(
    new PutCommand({
      TableName: table(),
      Item: { ...r, PK: k.pk, SK: k.sk, ...gsi },
    }),
  );
}

// ─────────────────────────── Waitlist ─────────────────────────

export async function putWaitlist(w: WaitlistEntry): Promise<void> {
  const k = waitlistKey(w.garage_id, w.item_id, w.joined_at, w.borrower_phone);
  await ddb().send(new PutCommand({ TableName: table(), Item: withKey(k, w) }));
}

export async function listWaitlist(garage_id: string, item_id: string): Promise<WaitlistEntry[]> {
  const r = await ddb().send(
    new QueryCommand({
      TableName: table(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `TENANT#${garage_id}`,
        ":sk": `WAIT#${item_id}#`,
      },
    }),
  );
  return (r.Items ?? []) as WaitlistEntry[];
}

export async function deleteWaitlist(
  garage_id: string,
  item_id: string,
  ts: string,
  phone: string,
): Promise<void> {
  const k = waitlistKey(garage_id, item_id, ts, phone);
  await ddb().send(new DeleteCommand({ TableName: table(), Key: { PK: k.pk, SK: k.sk } }));
}

// ─────────────────────────── Donation ─────────────────────────

export async function putDonation(d: DonationOffer): Promise<void> {
  const k = donationKey(d.garage_id, d.created_at.slice(0, 10), d.id);
  await ddb().send(new PutCommand({ TableName: table(), Item: withKey(k, d) }));
}

export async function listDonations(garage_id: string): Promise<DonationOffer[]> {
  const r = await ddb().send(
    new QueryCommand({
      TableName: table(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `TENANT#${garage_id}`,
        ":sk": "DONATION#",
      },
    }),
  );
  return (r.Items ?? []) as DonationOffer[];
}

export async function getDonation(
  garage_id: string,
  donation_id: string,
): Promise<DonationOffer | undefined> {
  return (await listDonations(garage_id)).find((d) => d.id === donation_id);
}

// ─────────────────────────── Incident ─────────────────────────

export async function putIncident(i: IncidentReport): Promise<void> {
  const k = incidentKey(i.garage_id, i.created_at.slice(0, 10), i.id);
  await ddb().send(new PutCommand({ TableName: table(), Item: withKey(k, i) }));
}

// ─────────────────────────── Notifications & Push ─────────────

export async function putNotification(n: Notification): Promise<void> {
  const k = notificationKey(n.user_phone, n.sent_at, n.id);
  await ddb().send(new PutCommand({ TableName: table(), Item: withKey(k, n) }));
}

export async function putPushSubscription(p: PushSubscription, hash: string): Promise<void> {
  const k = pushSubscriptionKey(p.user_phone, hash);
  await ddb().send(new PutCommand({ TableName: table(), Item: withKey(k, p) }));
}
