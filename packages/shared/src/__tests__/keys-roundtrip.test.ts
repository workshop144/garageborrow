// Every key builder round-trips through parseKey, and malformed keys are
// refused instead of being parsed into the wrong entity.

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  aiInteractionKey,
  auditLogKey,
  availabilityKey,
  donationKey,
  gsi1InviteByGarage,
  gsi1UserProfile,
  incidentKey,
  instanceKey,
  inviteKey,
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
  wishlistKey,
  wishlistVoteKey,
} from "../ddb/keys.js";
import { patchSchemaOf } from "../schemas/common.js";
import { tierRank } from "../logic/tier.js";

const G = "g1";
const P = "+15555550123";

describe("parseKey round trips", () => {
  it.each([
    [tenantMetaKey(G), { kind: "tenant_meta", garage_id: G }],
    [tenantUserKey(G, P), { kind: "tenant_user", garage_id: G, phone: P }],
    [tenantMemberKey(G, P), { kind: "tenant_member", garage_id: G, phone: P }],
    [itemKey(G, "i1"), { kind: "item", garage_id: G, item_id: "i1" }],
    [
      instanceKey(G, "i1", "n1"),
      { kind: "instance", garage_id: G, item_id: "i1", instance_id: "n1" },
    ],
    [
      loanKey(G, "2026-04-01", "l1"),
      { kind: "loan", garage_id: G, date: "2026-04-01", loan_id: "l1" },
    ],
    [
      reservationKey(G, "2026-04-01", "r1"),
      { kind: "reservation", garage_id: G, date: "2026-04-01", reservation_id: "r1" },
    ],
    [
      waitlistKey(G, "i1", "2026-04-01T00:00:00Z", P),
      { kind: "waitlist", garage_id: G, item_id: "i1", ts: "2026-04-01T00:00:00Z", phone: P },
    ],
    [
      donationKey(G, "2026-04-01", "d1"),
      { kind: "donation", garage_id: G, date: "2026-04-01", donation_id: "d1" },
    ],
    [
      incidentKey(G, "2026-04-01", "x1"),
      { kind: "incident", garage_id: G, date: "2026-04-01", incident_id: "x1" },
    ],
    [
      availabilityKey(G, "mon", "09:00"),
      { kind: "availability", garage_id: G, dow: "mon", start: "09:00" },
    ],
    [
      aiInteractionKey(G, "2026-04-01", "a1"),
      { kind: "ai_interaction", garage_id: G, date: "2026-04-01", interaction_id: "a1" },
    ],
    [
      auditLogKey(G, "2026-04-01", "u1"),
      { kind: "audit_log", garage_id: G, date: "2026-04-01", audit_id: "u1" },
    ],
    [
      wishlistKey(G, "2026-04-01", "w1"),
      { kind: "wishlist_request", garage_id: G, date: "2026-04-01", request_id: "w1" },
    ],
    [
      wishlistVoteKey(G, "w1", P),
      { kind: "wishlist_vote", garage_id: G, request_id: "w1", voter_phone: P },
    ],
    [
      notificationKey(P, "2026-04-01T00:00:00Z", "n1"),
      { kind: "notification", phone: P, ts: "2026-04-01T00:00:00Z", notification_id: "n1" },
    ],
    [pushSubscriptionKey(P, "abc"), { kind: "push_subscription", phone: P, endpoint_hash: "abc" }],
  ])("%o", (key, parsed) => {
    expect(parseKey(key.pk, key.sk)).toEqual(parsed);
  });
});

describe("parseKey refuses malformed keys", () => {
  it.each([
    ["TENANT#", "META"],
    ["USER#", "PUSH#x"],
    ["OTHER#x", "META"],
    ["TENANT#g", "USER#"],
    ["TENANT#g", "USER#a#b"],
    ["TENANT#g", "MEMBER#"],
    ["TENANT#g", "ITEM#i#OTHER#n"],
    ["TENANT#g", "ITEM#"],
    ["TENANT#g", "LOAN#2026-04-01"],
    ["TENANT#g", "RES#2026-04-01"],
    ["TENANT#g", "WAIT#i#ts"],
    ["TENANT#g", "DONATION#d"],
    ["TENANT#g", "INCIDENT#d"],
    ["TENANT#g", "AVAIL#mon"],
    ["TENANT#g", "AI#d"],
    ["TENANT#g", "AUDIT#d"],
    ["TENANT#g", "WISH#d"],
    ["TENANT#g", "WISHVOTE#w"],
    ["TENANT#g", "BOGUS#x"],
    ["USER#+1", "NOTIFICATION#ts"],
    ["USER#+1", "PUSH#"],
    ["USER#+1", "DEDUP#x#y"],
  ])("%s / %s", (pk, sk) => {
    expect(() => parseKey(pk, sk)).toThrow(KeyParseError);
  });
});

describe("builders refuse the key delimiter in any part", () => {
  it.each([
    () => inviteKey("+1#5", G),
    () => inviteKey(P, "g#1"),
    () => gsi1InviteByGarage("g#1", P),
    () => gsi1UserProfile("+1#5", G),
    () => auditLogKey(G, "2026#04", "u"),
    () => wishlistKey(G, "d", "w#1"),
    () => wishlistVoteKey(G, "w", "+1#5"),
  ])("%#", (fn) => {
    expect(fn).toThrow();
  });

  it("builds invite keys findable by phone and listable by garage", () => {
    expect(inviteKey(P, G)).toEqual({ pk: `INVITE#${P}`, sk: `GARAGE#${G}` });
    expect(gsi1InviteByGarage(G, P)).toEqual({ GSI1PK: `INVITES#${G}`, GSI1SK: `INVITE#${P}` });
    expect(gsi1UserProfile(P, G)).toEqual({ GSI1PK: `USER#${P}`, GSI1SK: `USER#${G}` });
  });
});

describe("GSI parsers", () => {
  it("parses GSI1 loan and reservation rows and refuses others", () => {
    expect(parseGsi1ByUser(`USER#${P}`, "LOAN#t")).toEqual({ kind: "loan", phone: P, ts: "t" });
    expect(parseGsi1ByUser(`USER#${P}`, "RES#t")).toEqual({
      kind: "reservation",
      phone: P,
      ts: "t",
    });
    expect(() => parseGsi1ByUser("TENANT#g", "LOAN#t")).toThrow(KeyParseError);
    expect(() => parseGsi1ByUser("USER#", "LOAN#t")).toThrow(KeyParseError);
    expect(() => parseGsi1ByUser(`USER#${P}`, "LOAN")).toThrow(KeyParseError);
    expect(() => parseGsi1ByUser(`USER#${P}`, `USER#${G}`)).toThrow(KeyParseError);
  });

  it("refuses malformed GSI2 keys", () => {
    expect(() => parseGsi2InstanceStatus("INST#i", "STATUS#a")).toThrow(KeyParseError);
    expect(() => parseGsi2InstanceStatus("INST#i#n", "STATE#a")).toThrow(KeyParseError);
    expect(parseGsi2InstanceStatus("INST#i#n", "STATUS#a")).toEqual({
      item_id: "i",
      instance_id: "n",
      status: "a",
    });
  });
});

describe("patchSchemaOf", () => {
  const Schema = z.object({
    name: z.string(),
    tags: z.array(z.string()).default([]),
    n: z.number(),
  });

  it("makes every field optional and drops defaults, so omitted keys stay absent", () => {
    const Patch = patchSchemaOf(Schema);
    expect(Patch.parse({})).toEqual({});
    expect(Patch.parse({ tags: ["a"] })).toEqual({ tags: ["a"] });
    expect(() => Patch.parse({ n: "x" })).toThrow();
  });
});

describe("tierRank", () => {
  it("orders howdy < friend < family", () => {
    expect(tierRank("howdy")).toBeLessThan(tierRank("friend"));
    expect(tierRank("friend")).toBeLessThan(tierRank("family"));
  });
});
