// Limits on member-created borrow requests and reservations.
//
// Every approval-required borrow or reservation writes a pending row to the
// owner's queue and pings the owner, and every auto-approved reservation holds
// a unit against everyone else. Without limits one member could flood the
// owner's phone and queue, or lock up every unit of an item for years.

import type { Reservation } from "@garageborrow/shared";

import { ApiError } from "./errors.js";
import { bumpWindowCounter, listReservationsByGarage } from "./repo.js";

const DAY_MS = 86_400_000;

// Borrow requests (approval path of POST /loans) plus reservations, per member
// per UTC day. Far above real use, like the wishlist and donation caps.
export const MAX_BORROW_REQUESTS_PER_DAY = 20;

// A reservation is at most as long as the longest loan (MAX_LOAN_DAYS in
// routes/loans.ts; repeated here to avoid a lib -> routes import).
export const MAX_RESERVATION_DAYS = 60;
// ...and starts no more than this far ahead.
export const MAX_RESERVATION_LEAD_DAYS = 90;
// Open (pending or approved, not yet ended) reservations one member may hold
// on one item. Stops one member taking every unit of a multi-unit item.
export const MAX_OPEN_RESERVATIONS_PER_ITEM = 2;

// Counts one borrow request or reservation against the member's daily cap.
export async function bumpBorrowRequestCount(phone: string, now = new Date()): Promise<void> {
  const ts = now.toISOString();
  const n = await bumpWindowCounter(
    "borrow-request",
    phone,
    ts.slice(0, 10),
    Math.floor(now.getTime() / 1000) + 2 * 86400,
  );
  if (n > MAX_BORROW_REQUESTS_PER_DAY) {
    throw new ApiError("rate_limited", "Daily borrow request limit reached; try again tomorrow");
  }
}

// 400 unless the window is no longer than MAX_RESERVATION_DAYS and starts
// within MAX_RESERVATION_LEAD_DAYS of now.
export function assertReservationWindow(
  window: { start: number; end: number },
  now = Date.now(),
): void {
  if (!Number.isFinite(window.start) || !Number.isFinite(window.end)) {
    throw new ApiError("bad_request", "Invalid reservation dates");
  }
  if (window.end - window.start > MAX_RESERVATION_DAYS * DAY_MS) {
    throw new ApiError(
      "bad_request",
      `A reservation can be at most ${MAX_RESERVATION_DAYS} days long`,
    );
  }
  if (window.start > now + MAX_RESERVATION_LEAD_DAYS * DAY_MS) {
    throw new ApiError(
      "bad_request",
      `Reservations can start at most ${MAX_RESERVATION_LEAD_DAYS} days ahead`,
    );
  }
}

// 409 when the member already has a pending request for this item, or (unless
// `pendingOnly`, used by borrow requests) already holds
// MAX_OPEN_RESERVATIONS_PER_ITEM open reservations on it.
export async function assertNoOpenRequest(
  garage_id: string,
  item_id: string,
  phone: string,
  opts: { pendingOnly?: boolean; now?: number } = {},
): Promise<void> {
  const now = opts.now ?? Date.now();
  const mine = (await listReservationsByGarage(garage_id)).filter(
    (r: Reservation) => r.item_id === item_id && r.borrower_phone === phone,
  );
  if (mine.some((r) => r.status === "pending")) {
    throw new ApiError("conflict", "You already have a pending request for this item");
  }
  if (opts.pendingOnly) return;
  const open = mine.filter((r) => r.status === "approved" && Date.parse(r.end_at) > now);
  if (open.length >= MAX_OPEN_RESERVATIONS_PER_ITEM) {
    throw new ApiError(
      "conflict",
      `You already hold ${MAX_OPEN_RESERVATIONS_PER_ITEM} reservations for this item`,
    );
  }
}
