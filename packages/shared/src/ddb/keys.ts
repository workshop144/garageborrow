import type { InstanceStatus } from "../schemas/instance.js";

export const KEY_DELIM = "#";

export interface DdbKey {
  pk: string;
  sk: string;
}

export interface Gsi1Attrs {
  GSI1PK: string;
  GSI1SK: string;
}

export interface Gsi2Attrs {
  GSI2PK: string;
  GSI2SK: string;
}

export interface Gsi3Attrs {
  GSI3PK: string;
  GSI3SK: string;
}

function assertNoHash(name: string, value: string): void {
  if (value.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  if (value.includes(KEY_DELIM)) {
    throw new Error(`${name} must not contain '${KEY_DELIM}': ${value}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Main-table key encoders
// ────────────────────────────────────────────────────────────────────────────

export function tenantMetaKey(garage_id: string): DdbKey {
  assertNoHash("garage_id", garage_id);
  return { pk: `TENANT#${garage_id}`, sk: "META" };
}

export function tenantUserKey(garage_id: string, phone: string): DdbKey {
  assertNoHash("garage_id", garage_id);
  assertNoHash("phone", phone);
  return { pk: `TENANT#${garage_id}`, sk: `USER#${phone}` };
}

export function tenantMemberKey(garage_id: string, phone: string): DdbKey {
  assertNoHash("garage_id", garage_id);
  assertNoHash("phone", phone);
  return { pk: `TENANT#${garage_id}`, sk: `MEMBER#${phone}` };
}

export function itemKey(garage_id: string, item_id: string): DdbKey {
  assertNoHash("garage_id", garage_id);
  assertNoHash("item_id", item_id);
  return { pk: `TENANT#${garage_id}`, sk: `ITEM#${item_id}` };
}

export function instanceKey(garage_id: string, item_id: string, instance_id: string): DdbKey {
  assertNoHash("garage_id", garage_id);
  assertNoHash("item_id", item_id);
  assertNoHash("instance_id", instance_id);
  return {
    pk: `TENANT#${garage_id}`,
    sk: `ITEM#${item_id}#INST#${instance_id}`,
  };
}

export function loanKey(garage_id: string, date: string, loan_id: string): DdbKey {
  assertNoHash("garage_id", garage_id);
  assertNoHash("date", date);
  assertNoHash("loan_id", loan_id);
  return { pk: `TENANT#${garage_id}`, sk: `LOAN#${date}#${loan_id}` };
}

export function reservationKey(garage_id: string, date: string, reservation_id: string): DdbKey {
  assertNoHash("garage_id", garage_id);
  assertNoHash("date", date);
  assertNoHash("reservation_id", reservation_id);
  return { pk: `TENANT#${garage_id}`, sk: `RES#${date}#${reservation_id}` };
}

export function waitlistKey(garage_id: string, item_id: string, ts: string, phone: string): DdbKey {
  assertNoHash("garage_id", garage_id);
  assertNoHash("item_id", item_id);
  assertNoHash("ts", ts);
  assertNoHash("phone", phone);
  return {
    pk: `TENANT#${garage_id}`,
    sk: `WAIT#${item_id}#${ts}#${phone}`,
  };
}

export function donationKey(garage_id: string, date: string, donation_id: string): DdbKey {
  assertNoHash("garage_id", garage_id);
  assertNoHash("date", date);
  assertNoHash("donation_id", donation_id);
  return {
    pk: `TENANT#${garage_id}`,
    sk: `DONATION#${date}#${donation_id}`,
  };
}

export function incidentKey(garage_id: string, date: string, incident_id: string): DdbKey {
  assertNoHash("garage_id", garage_id);
  assertNoHash("date", date);
  assertNoHash("incident_id", incident_id);
  return {
    pk: `TENANT#${garage_id}`,
    sk: `INCIDENT#${date}#${incident_id}`,
  };
}

export function availabilityKey(garage_id: string, dow: string, start: string): DdbKey {
  assertNoHash("garage_id", garage_id);
  assertNoHash("dow", dow);
  assertNoHash("start", start);
  return {
    pk: `TENANT#${garage_id}`,
    sk: `AVAIL#${dow}#${start}`,
  };
}

export function aiInteractionKey(garage_id: string, date: string, interaction_id: string): DdbKey {
  assertNoHash("garage_id", garage_id);
  assertNoHash("date", date);
  assertNoHash("interaction_id", interaction_id);
  return {
    pk: `TENANT#${garage_id}`,
    sk: `AI#${date}#${interaction_id}`,
  };
}

export function auditLogKey(garage_id: string, date: string, audit_id: string): DdbKey {
  assertNoHash("garage_id", garage_id);
  assertNoHash("date", date);
  assertNoHash("audit_id", audit_id);
  return {
    pk: `TENANT#${garage_id}`,
    sk: `AUDIT#${date}#${audit_id}`,
  };
}

export function wishlistKey(garage_id: string, date: string, request_id: string): DdbKey {
  assertNoHash("garage_id", garage_id);
  assertNoHash("date", date);
  assertNoHash("request_id", request_id);
  return {
    pk: `TENANT#${garage_id}`,
    sk: `WISH#${date}#${request_id}`,
  };
}

export function wishlistVoteKey(
  garage_id: string,
  request_id: string,
  voter_phone: string,
): DdbKey {
  assertNoHash("garage_id", garage_id);
  assertNoHash("request_id", request_id);
  assertNoHash("voter_phone", voter_phone);
  return {
    pk: `TENANT#${garage_id}`,
    sk: `WISHVOTE#${request_id}#${voter_phone}`,
  };
}

// Vote count is left-padded so DynamoDB string compare orders 0..999
// numerically when reading the partition descending. Three digits is plenty
// for a single-garage wishlist; if a request ever crosses 1000 votes we'll
// need to widen the pad.
export const WISHLIST_VOTE_PAD_WIDTH = 3;

export function padVoteCount(count: number): string {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`vote_count must be a non-negative integer: ${count}`);
  }
  return String(count).padStart(WISHLIST_VOTE_PAD_WIDTH, "0");
}

export function gsi3WishlistByVotes(
  garage_id: string,
  vote_count: number,
  date: string,
  request_id: string,
): Gsi3Attrs {
  assertNoHash("garage_id", garage_id);
  assertNoHash("date", date);
  assertNoHash("request_id", request_id);
  return {
    GSI3PK: `TENANT#${garage_id}#WISHLIST_OPEN`,
    GSI3SK: `VOTES#${padVoteCount(vote_count)}#${date}#${request_id}`,
  };
}

export function notificationKey(phone: string, ts: string, notification_id: string): DdbKey {
  assertNoHash("phone", phone);
  assertNoHash("ts", ts);
  assertNoHash("notification_id", notification_id);
  return {
    pk: `USER#${phone}`,
    sk: `NOTIFICATION#${ts}#${notification_id}`,
  };
}

export function pushSubscriptionKey(phone: string, endpoint_hash: string): DdbKey {
  assertNoHash("phone", phone);
  assertNoHash("endpoint_hash", endpoint_hash);
  return {
    pk: `USER#${phone}`,
    sk: `PUSH#${endpoint_hash}`,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// GSI encoders
// ────────────────────────────────────────────────────────────────────────────

export function gsi1LoanByUser(phone: string, ts: string): Gsi1Attrs {
  assertNoHash("phone", phone);
  assertNoHash("ts", ts);
  return {
    GSI1PK: `USER#${phone}`,
    GSI1SK: `LOAN#${ts}`,
  };
}

export function gsi1ReservationByUser(phone: string, ts: string): Gsi1Attrs {
  assertNoHash("phone", phone);
  assertNoHash("ts", ts);
  return {
    GSI1PK: `USER#${phone}`,
    GSI1SK: `RES#${ts}`,
  };
}

export function gsi2InstanceStatus(
  item_id: string,
  instance_id: string,
  status: InstanceStatus,
): Gsi2Attrs {
  assertNoHash("item_id", item_id);
  assertNoHash("instance_id", instance_id);
  assertNoHash("status", status);
  return {
    GSI2PK: `INST#${item_id}#${instance_id}`,
    GSI2SK: `STATUS#${status}`,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Main-table parser
// ────────────────────────────────────────────────────────────────────────────

export type ParsedKey =
  | { kind: "tenant_meta"; garage_id: string }
  | { kind: "tenant_user"; garage_id: string; phone: string }
  | { kind: "tenant_member"; garage_id: string; phone: string }
  | { kind: "item"; garage_id: string; item_id: string }
  | {
      kind: "instance";
      garage_id: string;
      item_id: string;
      instance_id: string;
    }
  | { kind: "loan"; garage_id: string; date: string; loan_id: string }
  | {
      kind: "reservation";
      garage_id: string;
      date: string;
      reservation_id: string;
    }
  | {
      kind: "waitlist";
      garage_id: string;
      item_id: string;
      ts: string;
      phone: string;
    }
  | { kind: "donation"; garage_id: string; date: string; donation_id: string }
  | { kind: "incident"; garage_id: string; date: string; incident_id: string }
  | { kind: "availability"; garage_id: string; dow: string; start: string }
  | {
      kind: "ai_interaction";
      garage_id: string;
      date: string;
      interaction_id: string;
    }
  | { kind: "audit_log"; garage_id: string; date: string; audit_id: string }
  | {
      kind: "wishlist_request";
      garage_id: string;
      date: string;
      request_id: string;
    }
  | {
      kind: "wishlist_vote";
      garage_id: string;
      request_id: string;
      voter_phone: string;
    }
  | {
      kind: "notification";
      phone: string;
      ts: string;
      notification_id: string;
    }
  | { kind: "push_subscription"; phone: string; endpoint_hash: string };

export class KeyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyParseError";
  }
}

const TENANT_PREFIX = "TENANT#";
const USER_PREFIX = "USER#";

export function parseKey(pk: string, sk: string): ParsedKey {
  if (pk.startsWith(TENANT_PREFIX)) {
    const garage_id = pk.slice(TENANT_PREFIX.length);
    if (garage_id.length === 0) {
      throw new KeyParseError(`Empty garage_id in PK: ${pk}`);
    }
    return parseTenantSk(garage_id, sk);
  }
  if (pk.startsWith(USER_PREFIX)) {
    const phone = pk.slice(USER_PREFIX.length);
    if (phone.length === 0) {
      throw new KeyParseError(`Empty phone in PK: ${pk}`);
    }
    return parseUserSk(phone, sk);
  }
  throw new KeyParseError(`Unrecognized PK prefix: ${pk}`);
}

function parseTenantSk(garage_id: string, sk: string): ParsedKey {
  if (sk === "META") {
    return { kind: "tenant_meta", garage_id };
  }
  const parts = sk.split(KEY_DELIM);
  const head = parts[0];
  switch (head) {
    case "USER": {
      if (parts.length !== 2 || !parts[1]) {
        throw new KeyParseError(`Invalid tenant USER SK: ${sk}`);
      }
      return { kind: "tenant_user", garage_id, phone: parts[1] };
    }
    case "MEMBER": {
      if (parts.length !== 2 || !parts[1]) {
        throw new KeyParseError(`Invalid tenant MEMBER SK: ${sk}`);
      }
      return { kind: "tenant_member", garage_id, phone: parts[1] };
    }
    case "ITEM": {
      if (parts.length === 2 && parts[1]) {
        return { kind: "item", garage_id, item_id: parts[1] };
      }
      if (parts.length === 4 && parts[1] && parts[2] === "INST" && parts[3]) {
        return {
          kind: "instance",
          garage_id,
          item_id: parts[1],
          instance_id: parts[3],
        };
      }
      throw new KeyParseError(`Invalid ITEM SK: ${sk}`);
    }
    case "LOAN": {
      if (parts.length !== 3 || !parts[1] || !parts[2]) {
        throw new KeyParseError(`Invalid LOAN SK: ${sk}`);
      }
      return { kind: "loan", garage_id, date: parts[1], loan_id: parts[2] };
    }
    case "RES": {
      if (parts.length !== 3 || !parts[1] || !parts[2]) {
        throw new KeyParseError(`Invalid RES SK: ${sk}`);
      }
      return {
        kind: "reservation",
        garage_id,
        date: parts[1],
        reservation_id: parts[2],
      };
    }
    case "WAIT": {
      if (parts.length !== 4 || !parts[1] || !parts[2] || !parts[3]) {
        throw new KeyParseError(`Invalid WAIT SK: ${sk}`);
      }
      return {
        kind: "waitlist",
        garage_id,
        item_id: parts[1],
        ts: parts[2],
        phone: parts[3],
      };
    }
    case "DONATION": {
      if (parts.length !== 3 || !parts[1] || !parts[2]) {
        throw new KeyParseError(`Invalid DONATION SK: ${sk}`);
      }
      return {
        kind: "donation",
        garage_id,
        date: parts[1],
        donation_id: parts[2],
      };
    }
    case "INCIDENT": {
      if (parts.length !== 3 || !parts[1] || !parts[2]) {
        throw new KeyParseError(`Invalid INCIDENT SK: ${sk}`);
      }
      return {
        kind: "incident",
        garage_id,
        date: parts[1],
        incident_id: parts[2],
      };
    }
    case "AVAIL": {
      if (parts.length !== 3 || !parts[1] || !parts[2]) {
        throw new KeyParseError(`Invalid AVAIL SK: ${sk}`);
      }
      return {
        kind: "availability",
        garage_id,
        dow: parts[1],
        start: parts[2],
      };
    }
    case "AI": {
      if (parts.length !== 3 || !parts[1] || !parts[2]) {
        throw new KeyParseError(`Invalid AI SK: ${sk}`);
      }
      return {
        kind: "ai_interaction",
        garage_id,
        date: parts[1],
        interaction_id: parts[2],
      };
    }
    case "AUDIT": {
      if (parts.length !== 3 || !parts[1] || !parts[2]) {
        throw new KeyParseError(`Invalid AUDIT SK: ${sk}`);
      }
      return {
        kind: "audit_log",
        garage_id,
        date: parts[1],
        audit_id: parts[2],
      };
    }
    case "WISH": {
      if (parts.length !== 3 || !parts[1] || !parts[2]) {
        throw new KeyParseError(`Invalid WISH SK: ${sk}`);
      }
      return {
        kind: "wishlist_request",
        garage_id,
        date: parts[1],
        request_id: parts[2],
      };
    }
    case "WISHVOTE": {
      if (parts.length !== 3 || !parts[1] || !parts[2]) {
        throw new KeyParseError(`Invalid WISHVOTE SK: ${sk}`);
      }
      return {
        kind: "wishlist_vote",
        garage_id,
        request_id: parts[1],
        voter_phone: parts[2],
      };
    }
    default:
      throw new KeyParseError(`Unrecognized tenant SK: ${sk}`);
  }
}

function parseUserSk(phone: string, sk: string): ParsedKey {
  const parts = sk.split(KEY_DELIM);
  const head = parts[0];
  switch (head) {
    case "NOTIFICATION": {
      if (parts.length !== 3 || !parts[1] || !parts[2]) {
        throw new KeyParseError(`Invalid NOTIFICATION SK: ${sk}`);
      }
      return {
        kind: "notification",
        phone,
        ts: parts[1],
        notification_id: parts[2],
      };
    }
    case "PUSH": {
      if (parts.length !== 2 || !parts[1]) {
        throw new KeyParseError(`Invalid PUSH SK: ${sk}`);
      }
      return {
        kind: "push_subscription",
        phone,
        endpoint_hash: parts[1],
      };
    }
    default:
      throw new KeyParseError(`Unrecognized user SK: ${sk}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// GSI parsers
// ────────────────────────────────────────────────────────────────────────────

export interface ParsedGsi1User {
  kind: "loan" | "reservation";
  phone: string;
  ts: string;
}

export function parseGsi1ByUser(pk: string, sk: string): ParsedGsi1User {
  if (!pk.startsWith(USER_PREFIX)) {
    throw new KeyParseError(`Invalid GSI1 PK: ${pk}`);
  }
  const phone = pk.slice(USER_PREFIX.length);
  if (!phone) throw new KeyParseError(`Empty phone in GSI1 PK: ${pk}`);
  const parts = sk.split(KEY_DELIM);
  if (parts.length !== 2 || !parts[1]) {
    throw new KeyParseError(`Invalid GSI1 SK: ${sk}`);
  }
  if (parts[0] === "LOAN") return { kind: "loan", phone, ts: parts[1] };
  if (parts[0] === "RES") return { kind: "reservation", phone, ts: parts[1] };
  throw new KeyParseError(`Unrecognized GSI1 SK head: ${sk}`);
}

export interface ParsedGsi2InstanceStatus {
  item_id: string;
  instance_id: string;
  status: string;
}

export function parseGsi2InstanceStatus(pk: string, sk: string): ParsedGsi2InstanceStatus {
  const pkParts = pk.split(KEY_DELIM);
  if (pkParts.length !== 3 || pkParts[0] !== "INST" || !pkParts[1] || !pkParts[2]) {
    throw new KeyParseError(`Invalid GSI2 PK: ${pk}`);
  }
  const skParts = sk.split(KEY_DELIM);
  if (skParts.length !== 2 || skParts[0] !== "STATUS" || !skParts[1]) {
    throw new KeyParseError(`Invalid GSI2 SK: ${sk}`);
  }
  return {
    item_id: pkParts[1],
    instance_id: pkParts[2],
    status: skParts[1],
  };
}
