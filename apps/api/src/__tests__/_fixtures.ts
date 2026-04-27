import {
  gsi1LoanByUser,
  instanceKey,
  itemKey,
  loanKey,
  tenantMemberKey,
  tenantMetaKey,
  tenantUserKey,
} from "@garageborrow/shared";
import type { Garage, GarageMembership, Instance, Item, Loan, User } from "@garageborrow/shared";

import { seedItem } from "./_setup.js";

export const GARAGE_ID = "test-garage";
export const OWNER_PHONE = "+15555550000";
export const FAMILY_PHONE = "+15555550100";
export const FRIEND_PHONE = "+15555550200";
export const HOWDY_PHONE = "+15555550300";

export function seedGarage(overrides: Partial<Garage> = {}): Garage {
  const now = "2026-04-01T12:00:00Z";
  const g: Garage = {
    id: GARAGE_ID,
    name: "Test Garage",
    owner_phone: OWNER_PHONE,
    city_slug: "sample-town",
    city_display: "Sample Town, ST",
    geo: null,
    quality_tiers: ["A", "B"],
    status: "open",
    payforward_orgs: [],
    ai_enabled: false,
    ai_min_tier: "family",
    ai_total_monthly_cap_cents: 500,
    ai_default_user_monthly_tokens: 100000,
    ai_default_model: "haiku",
    tier_labels: { howdy: "Howdy", friend: "Friend", family: "Family" },
    vouching_required: false,
    wishlist_enabled: true,
    wishlist_popular_threshold: 5,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  const k = tenantMetaKey(g.id);
  seedItem({ ...g, PK: k.pk, SK: k.sk });
  return g;
}

export function seedUser(phone: string, overrides: Partial<User> = {}): User {
  const u: User = {
    phone,
    display_name: `User ${phone.slice(-4)}`,
    visibility: "visible",
    garages_member_of: [GARAGE_ID],
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
    created_at: "2026-04-01T12:00:00Z",
    last_seen_at: "2026-04-01T12:00:00Z",
    ...overrides,
  };
  const k = tenantUserKey(GARAGE_ID, phone);
  seedItem({
    ...u,
    PK: k.pk,
    SK: k.sk,
    GSI1PK: `USER#${phone}`,
    GSI1SK: `USER#${GARAGE_ID}`,
  });
  return u;
}

export function seedMembership(
  phone: string,
  tier: "howdy" | "friend" | "family",
  overrides: Partial<GarageMembership> = {},
): GarageMembership {
  const m: GarageMembership = {
    garage_id: GARAGE_ID,
    user_phone: phone,
    tier,
    joined_at: "2026-04-01T12:00:00Z",
    borrows_total: 0,
    borrows_active: 0,
    returns_on_time: 0,
    returns_late: 0,
    no_shows: 0,
    ai_tokens_used_this_month: 0,
    ai_tokens_used_total: 0,
    celebration_pending: false,
    ...overrides,
  };
  const k = tenantMemberKey(GARAGE_ID, phone);
  seedItem({ ...m, PK: k.pk, SK: k.sk });
  return m;
}

export function seedItemRecord(overrides: Partial<Item> = {}): Item {
  const now = "2026-04-01T12:00:00Z";
  const it: Item = {
    id: overrides.id ?? "item-1",
    garage_id: GARAGE_ID,
    name: "Cordless Drill",
    description: "An 18V drill.",
    category: "power-tools",
    primary_photo_key: "uploads/test/img.jpg",
    default_duration_days: 3,
    requires_approval: false,
    min_tier: "howdy",
    auto_approve_tier: "family",
    tags: [],
    status: "available",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  const k = itemKey(GARAGE_ID, it.id);
  seedItem({ ...it, PK: k.pk, SK: k.sk });
  return it;
}

export function seedInstanceRecord(item_id: string, overrides: Partial<Instance> = {}): Instance {
  const now = "2026-04-01T12:00:00Z";
  const inst: Instance = {
    id: overrides.id ?? `inst-${item_id}-1`,
    item_id,
    garage_id: GARAGE_ID,
    label: "A",
    quality_tier: "A",
    status: "available",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  const k = instanceKey(GARAGE_ID, item_id, inst.id);
  seedItem({ ...inst, PK: k.pk, SK: k.sk });
  return inst;
}

export function seedLoanRecord(overrides: Partial<Loan> & { item_id: string }): Loan {
  const borrowed_at = overrides.borrowed_at ?? "2026-04-01T12:00:00Z";
  const defaults: Loan = {
    id: `loan-${overrides.item_id}-${borrowed_at}`,
    garage_id: GARAGE_ID,
    item_id: overrides.item_id,
    borrower_phone: FAMILY_PHONE,
    borrowed_at,
    expected_return_at: "2026-04-04T12:00:00Z",
    status: "returned",
    extension_count: 0,
    liability_acknowledged_at: borrowed_at,
    liability_copy_version: "v1",
  };
  const loan: Loan = { ...defaults, ...overrides };
  const k = loanKey(GARAGE_ID, borrowed_at.slice(0, 10), loan.id);
  const gsi = gsi1LoanByUser(loan.borrower_phone, borrowed_at);
  seedItem({ ...loan, PK: k.pk, SK: k.sk, ...gsi });
  return loan;
}
