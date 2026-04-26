import { Hono } from "hono";
import { resolveItemAccess } from "@garageborrow/shared";
import type { Loan } from "@garageborrow/shared";
import { z } from "zod";

import { mustGarage, mustMembership, mustUser } from "../lib/ctx.js";
import { ApiError } from "../lib/errors.js";
import { newId, nowIso } from "../lib/ids.js";
import { invokeNotifier } from "../lib/invoke.js";
import { LIABILITY_COPY_VERSION } from "../lib/liability.js";
import { logger } from "../lib/logger.js";
import {
  bumpMemberCounter,
  getItem,
  getLoan,
  putLoan,
  putReservation,
  updateLoan,
} from "../lib/repo.js";
import type { AppEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth.js";
import { loadGarageContext } from "../middleware/garage-context.js";
import { idempotency } from "../middleware/idempotency.js";
import { ownerOnly } from "../middleware/owner-only.js";

export const loanRoutes = new Hono<AppEnv>();

loanRoutes.use("/v1/g/:garage/loans", requireAuth(), loadGarageContext());
loanRoutes.use("/v1/g/:garage/loans/*", requireAuth(), loadGarageContext());

const BorrowSchema = z.object({
  item_id: z.string().min(1),
  instance_id: z.string().min(1).optional(),
  duration_days: z.number().int().positive().optional(),
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
  if (access === "hidden") {
    throw new ApiError("forbidden", "You don't have access to this item");
  }
  const ts = nowIso();
  const durationDays = body.duration_days ?? item.default_duration_days;
  const expectedReturnAt = new Date(Date.now() + durationDays * 86400_000).toISOString();
  if (access === "request" || item.requires_approval) {
    const reservation = {
      id: newId(),
      garage_id: garage.id,
      item_id: item.id,
      ...(body.instance_id ? { instance_id: body.instance_id } : {}),
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
  const loan: Loan = {
    id: newId(),
    garage_id: garage.id,
    item_id: item.id,
    ...(body.instance_id ? { instance_id: body.instance_id } : {}),
    borrower_phone: user.phone,
    borrowed_at: ts,
    expected_return_at: expectedReturnAt,
    status: "active",
    extension_count: 0,
    liability_acknowledged_at: ts,
    liability_copy_version: LIABILITY_COPY_VERSION,
  };
  await putLoan(loan);
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
  await updateLoan(next);
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
  const loan = await getLoan(garage.id, id);
  if (!loan) throw new ApiError("not_found", "Loan not found");
  ReturnSchema.parse(await c.req.json().catch(() => ({})));
  // Mark return claimed; the actual `returned` status flips after a 48h
  // dispute window (see auto-confirm sweep). If owner returns the call,
  // we can short-circuit. Here we record return_claimed_at on the loan.
  const ts = nowIso();
  const next: Loan & { return_claimed_at?: string; return_claimed_by?: string } = {
    ...loan,
    actual_return_at: ts,
  };
  (next as { return_claimed_at?: string }).return_claimed_at = ts;
  (next as { return_claimed_by?: string }).return_claimed_by = user.phone;
  await updateLoan(next);
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
  const loan = await getLoan(garage.id, id);
  if (!loan) throw new ApiError("not_found", "Loan not found");
  const body = DisputeSchema.parse(await c.req.json());
  const ts = nowIso();
  const next: Loan & { disputed_at?: string; dispute_reason?: string } = { ...loan };
  (next as { disputed_at?: string }).disputed_at = ts;
  (next as { dispute_reason?: string }).dispute_reason = body.reason;
  await updateLoan(next);
  await invokeNotifier({
    type: "loan_disputed",
    garage_id: garage.id,
    user_phone: loan.borrower_phone,
    payload: { loan_id: loan.id, reason: body.reason },
  });
  return c.json({ loan: next });
});

// Sweep helper exposed for the notifier/account-cleaner Lambdas (and tests):
// after 48h of silence on a return claim, flip the loan to status=returned.
export async function autoConfirmReturns(
  garage_id: string,
  cutoffMs = Date.now() - 48 * 3600_000,
): Promise<number> {
  const cutoffIso = new Date(cutoffMs).toISOString();
  const { listOverdueAutoConfirm } = await import("../lib/repo.js");
  const candidates = await listOverdueAutoConfirm(garage_id, cutoffIso);
  let count = 0;
  for (const loan of candidates) {
    const next: Loan = { ...loan, status: "returned" };
    await updateLoan(next);
    await bumpMemberCounter(garage_id, loan.borrower_phone, "borrows_active", -1);
    await bumpMemberCounter(garage_id, loan.borrower_phone, "returns_on_time", 1);
    count++;
  }
  return count;
}
