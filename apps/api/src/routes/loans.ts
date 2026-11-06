import { Hono } from "hono";
import { resolveItemAccess } from "@garageborrow/shared";
import type { Loan } from "@garageborrow/shared";
import { z } from "zod";

import { mustGarage, mustMembership, mustUser } from "../lib/ctx.js";
import { ApiError } from "../lib/errors.js";
import { newId, nowIso } from "../lib/ids.js";
import { invokeNotifier } from "../lib/invoke.js";
import { assertAvailable, commitAvailable } from "../lib/availability.js";
import { LIABILITY_COPY_VERSION } from "../lib/liability.js";
import { AUTO_CONFIRM_AFTER_MS, confirmClaimedReturns } from "../lib/loan-lifecycle.js";
import { logger } from "../lib/logger.js";
import {
  bumpMemberCounter,
  getItem,
  getLoan,
  loanRow,
  type LoanRecord,
  putReservation,
  updateLoan,
} from "../lib/repo.js";
import type { AppEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth.js";
import { loadGarageContext } from "../middleware/garage-context.js";
import { idempotency } from "../middleware/idempotency.js";
import { ownerOnly } from "../middleware/owner-only.js";

export const loanRoutes = new Hono<AppEnv>();

// The loan changed between our read and our conditional write.
function loanChanged(): ApiError {
  return new ApiError("conflict", "This loan just changed; reload and try again");
}

loanRoutes.use("/v1/g/:garage/loans", requireAuth(), loadGarageContext());
loanRoutes.use("/v1/g/:garage/loans/*", requireAuth(), loadGarageContext());

export const MAX_LOAN_DAYS = 60;

const BorrowSchema = z.object({
  item_id: z.string().min(1),
  instance_id: z.string().min(1).optional(),
  // Bounded: an unbounded value overflowed Date (500) or held a unit for years.
  duration_days: z.number().int().positive().max(MAX_LOAN_DAYS).optional(),
  liability_acknowledged: z.literal(true),
});

loanRoutes.use("/v1/g/:garage/loans", idempotency());
loanRoutes.post("/v1/g/:garage/loans", async (c) => {
  const garage = mustGarage(c);
  const user = mustUser(c);
  const membership = mustMembership(c);
  const body = BorrowSchema.parse(await c.req.json());
  const item = await getItem(garage.id, body.item_id);
  if (!item) throw new ApiError("not_found", "Item not found");
  const access = resolveItemAccess(membership.tier, item.min_tier, item.auto_approve_tier);
  // Same answer as a missing item: tier-hidden items are not acknowledged.
  if (access === "hidden") throw new ApiError("not_found", "Item not found");
  const ts = nowIso();
  const durationDays = body.duration_days ?? item.default_duration_days;
  const expectedReturnAt = new Date(Date.now() + durationDays * 86400_000).toISOString();
  const needsApproval = access === "request" || item.requires_approval;
  const window = { start: Date.parse(ts), end: Date.parse(expectedReturnAt) };
  if (needsApproval) {
    const instanceId = await assertAvailable({
      item,
      instanceId: body.instance_id,
      borrowerPhone: user.phone,
      window,
      commits: false,
    });
    const reservation = {
      id: newId(),
      garage_id: garage.id,
      item_id: item.id,
      ...(instanceId ? { instance_id: instanceId } : {}),
      borrower_phone: user.phone,
      start_at: ts,
      end_at: expectedReturnAt,
      status: "pending" as const,
      approval_required: true,
    };
    await putReservation(reservation);
    return c.json(
      {
        reservation,
        message: "Approval required — owner has been notified.",
      },
      202,
    );
  }
  const loan = await commitAvailable(
    { item, instanceId: body.instance_id, borrowerPhone: user.phone, window },
    (instanceId): Loan => ({
      id: newId(),
      garage_id: garage.id,
      item_id: item.id,
      ...(instanceId ? { instance_id: instanceId } : {}),
      borrower_phone: user.phone,
      borrowed_at: ts,
      expected_return_at: expectedReturnAt,
      status: "active",
      extension_count: 0,
      liability_acknowledged_at: ts,
      liability_copy_version: LIABILITY_COPY_VERSION,
    }),
    loanRow,
  );
  await bumpMemberCounter(garage.id, user.phone, "borrows_total", 1);
  await bumpMemberCounter(garage.id, user.phone, "borrows_active", 1);
  logger.info({ garage_id: garage.id, item_id: item.id, loan_id: loan.id }, "loan_created");
  return c.json({ loan }, 201);
});

loanRoutes.use("/v1/g/:garage/loans/:id/extend", idempotency());
loanRoutes.post("/v1/g/:garage/loans/:id/extend", async (c) => {
  const garage = mustGarage(c);
  const user = mustUser(c);
  const id = c.req.param("id");
  if (!id) throw new ApiError("bad_request", "Missing id");
  const loan = await getLoan(garage.id, id);
  if (!loan) throw new ApiError("not_found", "Loan not found");
  if (loan.borrower_phone !== user.phone) {
    throw new ApiError("forbidden", "Not your loan");
  }
  if (loan.status !== "active") {
    throw new ApiError("conflict", "Loan is not active");
  }
  const next: Loan = {
    ...loan,
    expected_return_at: new Date(
      new Date(loan.expected_return_at).getTime() + 3 * 86400_000,
    ).toISOString(),
    extension_count: loan.extension_count + 1,
    last_extended_at: nowIso(),
  };
  if (!(await updateLoan(next, loan))) throw loanChanged();
  await invokeNotifier({
    type: "loan_extended",
    garage_id: garage.id,
    user_phone: loan.borrower_phone,
    payload: { loan_id: loan.id, new_expected_return_at: next.expected_return_at },
  });
  return c.json({ loan: next });
});

const ReturnSchema = z.object({
  notes: z.string().optional(),
});

loanRoutes.use("/v1/g/:garage/loans/:id/return", idempotency());
loanRoutes.post("/v1/g/:garage/loans/:id/return", async (c) => {
  const garage = mustGarage(c);
  const user = mustUser(c);
  const id = c.req.param("id");
  if (!id) throw new ApiError("bad_request", "Missing id");
  const loan: LoanRecord | undefined = await getLoan(garage.id, id);
  if (!loan) throw new ApiError("not_found", "Loan not found");
  ReturnSchema.parse(await c.req.json().catch(() => ({})));
  // Only the borrower claims a return (the owner has /admin/loans/:id/return):
  // a claim puts the unit back on the shelf for availability.
  if (loan.borrower_phone !== user.phone) {
    throw new ApiError("forbidden", "Not your loan");
  }
  if (loan.status !== "active" && loan.status !== "overdue") {
    throw new ApiError("conflict", "Loan is not out");
  }
  // A repeat would move the claim forward and restart the dispute window.
  if (loan.return_claimed_at) {
    throw new ApiError("conflict", "Return already claimed");
  }
  // Mark return claimed; the actual `returned` status flips after a 48h
  // dispute window (see auto-confirm sweep) or when the owner confirms.
  const ts = nowIso();
  const next: LoanRecord = {
    ...loan,
    actual_return_at: ts,
    return_claimed_at: ts,
    return_claimed_by: user.phone,
  };
  if (!(await updateLoan(next, loan))) throw loanChanged();
  await invokeNotifier({
    type: "loan_returned",
    garage_id: garage.id,
    user_phone: loan.borrower_phone,
    payload: { loan_id: loan.id, claimed_at: ts },
  });
  return c.json({ loan: next, message: "Marked returned. Owner has 48h to dispute." });
});

const DisputeSchema = z.object({
  reason: z.string().min(1),
});

loanRoutes.use("/v1/g/:garage/loans/:id/dispute", idempotency());
loanRoutes.post("/v1/g/:garage/loans/:id/dispute", ownerOnly(), async (c) => {
  const garage = mustGarage(c);
  const id = c.req.param("id");
  if (!id) throw new ApiError("bad_request", "Missing id");
  const loan: LoanRecord | undefined = await getLoan(garage.id, id);
  if (!loan) throw new ApiError("not_found", "Loan not found");
  const body = DisputeSchema.parse(await c.req.json());
  if ((loan.status !== "active" && loan.status !== "overdue") || !loan.return_claimed_at) {
    throw new ApiError("conflict", "There is no return claim to dispute");
  }
  const ts = nowIso();
  // Disputing says the unit is still out: drop the claim so availability
  // counts the loan again and the auto-confirm sweep leaves it alone. A
  // disputed loan is closed by the owner's own return, never auto-confirmed.
  const {
    actual_return_at: _actual,
    return_claimed_at: _claimed,
    return_claimed_by: _by,
    ...rest
  } = loan;
  const next: LoanRecord = { ...rest, disputed_at: ts, dispute_reason: body.reason };
  if (!(await updateLoan(next, loan))) throw loanChanged();
  await invokeNotifier({
    type: "loan_disputed",
    garage_id: garage.id,
    user_phone: loan.borrower_phone,
    payload: { loan_id: loan.id, reason: body.reason },
  });
  return c.json({ loan: next });
});

// The notifier cron runs this per garage (see lib/loan-lifecycle.ts); kept
// here for callers that only want the count.
export async function autoConfirmReturns(
  garage_id: string,
  cutoffMs = Date.now() - AUTO_CONFIRM_AFTER_MS,
): Promise<number> {
  return (await confirmClaimedReturns(garage_id, cutoffMs)).length;
}
