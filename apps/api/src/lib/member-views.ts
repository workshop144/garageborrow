import type { DonationOffer, Item, Loan, Reservation, WaitlistEntry } from "@garageborrow/shared";

// What a donor may see of their own donation offer. The row also carries the
// owner's private `owner_notes` and the deciding owner's phone; members never
// see either (owner-private data, and phones are admin-only). `decline_reason`
// stays: it is written for the donor and the web shows it on My donations.
export type MemberDonationView = Omit<DonationOffer, "owner_notes" | "decided_by_phone">;

export function memberDonationView(d: DonationOffer): MemberDonationView {
  const {
    owner_notes: _ownerNotes,
    decided_by_phone: _decidedBy,
    ...rest
  } = d as DonationOffer & Record<string, unknown>;
  return rest;
}

// Copies only the listed keys that are present. My Stuff builds its rows from
// stored records that also carry table keys, the loan's `rev`, and other
// people's phones (the owner who decided or cancelled a reservation); an
// allowlist keeps any field added to those rows later out of the response.
function pick<K extends string>(row: object, keys: readonly K[]): Record<K, unknown> {
  const src = row as Record<string, unknown>;
  const out: Partial<Record<K, unknown>> = {};
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out as Record<K, unknown>;
}

const MEMBER_LOAN_FIELDS = [
  "id",
  "garage_id",
  "item_id",
  "instance_id",
  "borrower_phone",
  "borrowed_at",
  "expected_return_at",
  "actual_return_at",
  "status",
  "extension_count",
  "last_extended_at",
  "liability_acknowledged_at",
  "liability_copy_version",
  // Claim and dispute state of the borrower's own return; the dispute reason
  // is sent to the borrower in the loan_disputed notification as well.
  "return_claimed_at",
  "disputed_at",
  "dispute_reason",
] as const;

export type MemberLoanView = Loan & {
  return_claimed_at?: string;
  disputed_at?: string;
  dispute_reason?: string;
};

// The borrower's view of their own loan: no `rev`, no `return_claimed_by`.
export function memberLoanView(l: Loan): MemberLoanView {
  return pick(l, MEMBER_LOAN_FIELDS) as unknown as MemberLoanView;
}

const MEMBER_RESERVATION_FIELDS = [
  "id",
  "garage_id",
  "item_id",
  "instance_id",
  "borrower_phone",
  "start_at",
  "end_at",
  "status",
  "approval_required",
  "decided_at",
  "decline_reason",
  "cancelled_at",
  "source",
] as const;

export type MemberReservationView = Omit<Reservation, "decided_by_phone" | "cancelled_by_phone">;

// The requester's view of their own reservation: who decided or cancelled it
// (the owner's phone) stays out, members never see other people's phones.
export function memberReservationView(r: Reservation): MemberReservationView {
  return pick(r, MEMBER_RESERVATION_FIELDS) as unknown as MemberReservationView;
}

const MEMBER_WAITLIST_FIELDS = [
  "id",
  "garage_id",
  "item_id",
  "borrower_phone",
  "joined_at",
  "position",
  "notify_when_available",
] as const;

export function memberWaitlistView(w: WaitlistEntry): WaitlistEntry {
  return pick(w, MEMBER_WAITLIST_FIELDS) as unknown as WaitlistEntry;
}

// The item summary My Stuff shows next to each row (the fields the web reads).
export interface MyStuffItemView {
  id: string;
  name: string;
  primary_photo_key: string;
  category: string;
}

export function myStuffItemView(item: Item | undefined, itemId: string): MyStuffItemView {
  if (!item) return { id: itemId, name: "Removed item", primary_photo_key: "", category: "" };
  return {
    id: item.id,
    name: item.name,
    primary_photo_key: item.primary_photo_key,
    category: item.category,
  };
}
