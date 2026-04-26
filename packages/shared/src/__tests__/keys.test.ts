import { describe, expect, it } from "vitest";

import {
  aiInteractionKey,
  availabilityKey,
  donationKey,
  gsi1LoanByUser,
  gsi1ReservationByUser,
  gsi2InstanceStatus,
  incidentKey,
  instanceKey,
  itemKey,
  KeyParseError,
  loanKey,
  notificationKey,
  parseGsi1ByUser,
  parseGsi2InstanceStatus,
  parseKey,
  pushSubscriptionKey,
  reservationKey,
  tenantMemberKey,
  tenantMetaKey,
  tenantUserKey,
  waitlistKey,
} from "../ddb/keys.js";

const GARAGE = "demo-garage";
const PHONE = "+15551234567";
const ITEM = "item_abc123";
const INSTANCE = "inst_xyz789";
const DATE = "2026-04-25";
const TS = "2026-04-25T14:30:00Z";
const ID = "01HZAB12CD34EF56GH78";

describe("DDB main-table keys: round-trip", () => {
  it("TENANT META", () => {
    const k = tenantMetaKey(GARAGE);
    expect(k).toEqual({ pk: `TENANT#${GARAGE}`, sk: "META" });
    expect(parseKey(k.pk, k.sk)).toEqual({
      kind: "tenant_meta",
      garage_id: GARAGE,
    });
  });

  it("TENANT USER#{phone}", () => {
    const k = tenantUserKey(GARAGE, PHONE);
    expect(k).toEqual({
      pk: `TENANT#${GARAGE}`,
      sk: `USER#${PHONE}`,
    });
    expect(parseKey(k.pk, k.sk)).toEqual({
      kind: "tenant_user",
      garage_id: GARAGE,
      phone: PHONE,
    });
  });

  it("TENANT MEMBER#{phone}", () => {
    const k = tenantMemberKey(GARAGE, PHONE);
    expect(k.sk).toBe(`MEMBER#${PHONE}`);
    expect(parseKey(k.pk, k.sk)).toEqual({
      kind: "tenant_member",
      garage_id: GARAGE,
      phone: PHONE,
    });
  });

  it("ITEM#{item_id}", () => {
    const k = itemKey(GARAGE, ITEM);
    expect(k.sk).toBe(`ITEM#${ITEM}`);
    expect(parseKey(k.pk, k.sk)).toEqual({
      kind: "item",
      garage_id: GARAGE,
      item_id: ITEM,
    });
  });

  it("ITEM#{item_id}#INST#{instance_id}", () => {
    const k = instanceKey(GARAGE, ITEM, INSTANCE);
    expect(k.sk).toBe(`ITEM#${ITEM}#INST#${INSTANCE}`);
    expect(parseKey(k.pk, k.sk)).toEqual({
      kind: "instance",
      garage_id: GARAGE,
      item_id: ITEM,
      instance_id: INSTANCE,
    });
  });

  it("LOAN#{date}#{loan_id}", () => {
    const k = loanKey(GARAGE, DATE, ID);
    expect(k.sk).toBe(`LOAN#${DATE}#${ID}`);
    expect(parseKey(k.pk, k.sk)).toEqual({
      kind: "loan",
      garage_id: GARAGE,
      date: DATE,
      loan_id: ID,
    });
  });

  it("RES#{date}#{reservation_id}", () => {
    const k = reservationKey(GARAGE, DATE, ID);
    expect(k.sk).toBe(`RES#${DATE}#${ID}`);
    expect(parseKey(k.pk, k.sk)).toEqual({
      kind: "reservation",
      garage_id: GARAGE,
      date: DATE,
      reservation_id: ID,
    });
  });

  it("WAIT#{item_id}#{ts}#{phone}", () => {
    const k = waitlistKey(GARAGE, ITEM, TS, PHONE);
    expect(k.sk).toBe(`WAIT#${ITEM}#${TS}#${PHONE}`);
    expect(parseKey(k.pk, k.sk)).toEqual({
      kind: "waitlist",
      garage_id: GARAGE,
      item_id: ITEM,
      ts: TS,
      phone: PHONE,
    });
  });

  it("DONATION#{date}#{id}", () => {
    const k = donationKey(GARAGE, DATE, ID);
    expect(k.sk).toBe(`DONATION#${DATE}#${ID}`);
    expect(parseKey(k.pk, k.sk)).toEqual({
      kind: "donation",
      garage_id: GARAGE,
      date: DATE,
      donation_id: ID,
    });
  });

  it("INCIDENT#{date}#{id}", () => {
    const k = incidentKey(GARAGE, DATE, ID);
    expect(k.sk).toBe(`INCIDENT#${DATE}#${ID}`);
    expect(parseKey(k.pk, k.sk)).toEqual({
      kind: "incident",
      garage_id: GARAGE,
      date: DATE,
      incident_id: ID,
    });
  });

  it("AVAIL#{dow}#{start}", () => {
    const k = availabilityKey(GARAGE, "MON", "08:00");
    expect(k.sk).toBe(`AVAIL#MON#08:00`);
    expect(parseKey(k.pk, k.sk)).toEqual({
      kind: "availability",
      garage_id: GARAGE,
      dow: "MON",
      start: "08:00",
    });
  });

  it("AI#{date}#{interaction_id}", () => {
    const k = aiInteractionKey(GARAGE, DATE, ID);
    expect(k.sk).toBe(`AI#${DATE}#${ID}`);
    expect(parseKey(k.pk, k.sk)).toEqual({
      kind: "ai_interaction",
      garage_id: GARAGE,
      date: DATE,
      interaction_id: ID,
    });
  });

  it("USER NOTIFICATION#{ts}#{id}", () => {
    const k = notificationKey(PHONE, TS, ID);
    expect(k).toEqual({
      pk: `USER#${PHONE}`,
      sk: `NOTIFICATION#${TS}#${ID}`,
    });
    expect(parseKey(k.pk, k.sk)).toEqual({
      kind: "notification",
      phone: PHONE,
      ts: TS,
      notification_id: ID,
    });
  });

  it("USER PUSH#{endpoint_hash}", () => {
    const hash = "deadbeef0123456789abcdef";
    const k = pushSubscriptionKey(PHONE, hash);
    expect(k).toEqual({
      pk: `USER#${PHONE}`,
      sk: `PUSH#${hash}`,
    });
    expect(parseKey(k.pk, k.sk)).toEqual({
      kind: "push_subscription",
      phone: PHONE,
      endpoint_hash: hash,
    });
  });
});

describe("DDB GSI keys: round-trip", () => {
  it("GSI1 byUser LOAN", () => {
    const k = gsi1LoanByUser(PHONE, TS);
    expect(k).toEqual({
      GSI1PK: `USER#${PHONE}`,
      GSI1SK: `LOAN#${TS}`,
    });
    expect(parseGsi1ByUser(k.GSI1PK, k.GSI1SK)).toEqual({
      kind: "loan",
      phone: PHONE,
      ts: TS,
    });
  });

  it("GSI1 byUser RES", () => {
    const k = gsi1ReservationByUser(PHONE, TS);
    expect(k).toEqual({
      GSI1PK: `USER#${PHONE}`,
      GSI1SK: `RES#${TS}`,
    });
    expect(parseGsi1ByUser(k.GSI1PK, k.GSI1SK)).toEqual({
      kind: "reservation",
      phone: PHONE,
      ts: TS,
    });
  });

  it("GSI2 byInstanceStatus", () => {
    const k = gsi2InstanceStatus(ITEM, INSTANCE, "loaned");
    expect(k).toEqual({
      GSI2PK: `INST#${ITEM}#${INSTANCE}`,
      GSI2SK: `STATUS#loaned`,
    });
    expect(parseGsi2InstanceStatus(k.GSI2PK, k.GSI2SK)).toEqual({
      item_id: ITEM,
      instance_id: INSTANCE,
      status: "loaned",
    });
  });
});

describe("DDB key encoder validation", () => {
  it("rejects '#' in component", () => {
    expect(() => itemKey(GARAGE, "bad#id")).toThrow(/must not contain/);
  });

  it("rejects empty component", () => {
    expect(() => tenantMetaKey("")).toThrow(/must not be empty/);
  });
});

describe("DDB parser errors", () => {
  it("unknown PK prefix", () => {
    expect(() => parseKey("FOO#x", "META")).toThrow(KeyParseError);
  });

  it("unknown tenant SK", () => {
    expect(() => parseKey(`TENANT#${GARAGE}`, "BOGUS#1")).toThrow(KeyParseError);
  });

  it("malformed LOAN sk", () => {
    expect(() => parseKey(`TENANT#${GARAGE}`, "LOAN#only-one")).toThrow(KeyParseError);
  });
});
