// Server-side availability for borrow and reserve. The web UI only offers
// "Borrow it" on available items, but the API is reachable directly, so the
// owner-set item/instance state and existing commitments are enforced here.

import type { Instance, Item, Loan, Reservation } from "@garageborrow/shared";

import { ApiError } from "./errors.js";
import { listInstances, listLoansByGarage, listReservationsByGarage } from "./repo.js";

// Owner-set item states that still accept borrows. all_loaned, broken,
// maintenance, retired and lost do not.
const BORROWABLE_ITEM_STATUS = new Set<Item["status"]>(["available", "partial_loaned"]);
// Instance states that count as a lendable unit at all. "loaned"/"reserved" are
// informational (the commitment itself is the loan/reservation row) and are
// judged against those rows below; the rest take the unit out of service.
const OUT_OF_SERVICE_INSTANCE = new Set<Instance["status"]>(["maintenance", "broken", "retired"]);
const OUT_LOAN_STATUS = new Set<Loan["status"]>(["active", "overdue"]);

export interface Window {
  start: number;
  end: number;
}

export interface AvailabilityCheck {
  item: Item;
  instanceId?: string | undefined;
  borrowerPhone: string;
  window: Window;
  // true when the write would take a unit now (active loan / approved
  // reservation); false for a pending request the owner will decide.
  commits: boolean;
}

function overlaps(a: Window, b: Window): boolean {
  return a.start < b.end && b.start < a.end;
}

function loanWindow(l: Loan): Window {
  // An out loan holds its unit until it comes back, however late.
  const due = Date.parse(l.expected_return_at);
  const late = l.status === "overdue" || due <= Date.now();
  return { start: Date.parse(l.borrowed_at), end: late ? Infinity : due };
}

// Throws ApiError unless the item (and instance, when given) can take this
// borrow or reservation. Returns the instance to record on the loan, if any.
export async function assertAvailable(check: AvailabilityCheck): Promise<string | undefined> {
  const { item, instanceId, borrowerPhone, window } = check;
  if (!(window.start < window.end)) {
    throw new ApiError("bad_request", "start must be before end");
  }
  if (!BORROWABLE_ITEM_STATUS.has(item.status)) {
    throw new ApiError("conflict", "This item is not available to borrow right now");
  }
  const instances = await listInstances(item.garage_id, item.id);
  let target: Instance | undefined;
  if (instanceId !== undefined) {
    target = instances.find((i) => i.id === instanceId && i.item_id === item.id);
    if (!target) throw new ApiError("not_found", "Instance not found");
    if (OUT_OF_SERVICE_INSTANCE.has(target.status)) {
      throw new ApiError("conflict", "This unit is not available to borrow right now");
    }
  }
  if (!check.commits) return instanceId;

  const [loans, reservations] = await Promise.all([
    listLoansByGarage(item.garage_id),
    listReservationsByGarage(item.garage_id),
  ]);
  const commitments: { instance_id?: string | undefined }[] = [
    ...loans.filter(
      (l) =>
        l.item_id === item.id &&
        OUT_LOAN_STATUS.has(l.status) &&
        // A claimed return is back on the shelf while the owner's dispute window runs.
        !l.actual_return_at &&
        overlaps(loanWindow(l), window),
    ),
    ...reservations.filter(
      (r: Reservation) =>
        r.item_id === item.id &&
        r.status === "approved" &&
        // A member borrowing against their own reservation is fulfilling it.
        r.borrower_phone !== borrowerPhone &&
        overlaps({ start: Date.parse(r.start_at), end: Date.parse(r.end_at) }, window),
    ),
  ];

  if (instances.length === 0) {
    // Single-unit item: any overlapping commitment takes the only unit.
    if (commitments.length > 0) {
      throw new ApiError("conflict", "This item is already out or reserved for that time");
    }
    return undefined;
  }

  const usable = instances.filter((i) => !OUT_OF_SERVICE_INSTANCE.has(i.status));
  const held = new Set(commitments.map((c) => c.instance_id).filter((x): x is string => !!x));
  const unassigned = commitments.filter((c) => !c.instance_id).length;
  if (target) {
    if (held.has(target.id)) {
      throw new ApiError("conflict", "This unit is already out or reserved for that time");
    }
    // Unassigned commitments still need some free unit of their own.
    const freeOthers = usable.filter((i) => i.id !== target.id && !held.has(i.id)).length;
    if (unassigned > freeOthers) {
      throw new ApiError("conflict", "No unit of this item is free for that time");
    }
    return target.id;
  }
  const free = usable.filter((i) => !held.has(i.id));
  if (free.length <= unassigned) {
    throw new ApiError("conflict", "No unit of this item is free for that time");
  }
  // Record a concrete unit so later checks can count it precisely.
  return free[0]?.id;
}
