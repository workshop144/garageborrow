import type { DonationOffer } from "@garageborrow/shared";

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
