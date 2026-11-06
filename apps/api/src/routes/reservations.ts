import { Hono } from "hono";
import { resolveItemAccess } from "@garageborrow/shared";
import type { Reservation } from "@garageborrow/shared";
import { z } from "zod";

import { mustGarage, mustMembership, mustUser } from "../lib/ctx.js";
import { ApiError } from "../lib/errors.js";
import { newId, nowIso } from "../lib/ids.js";
import { assertAvailable, commitAvailable } from "../lib/availability.js";
import {
  assertNoOpenRequest,
  assertReservationWindow,
  bumpBorrowRequestCount,
} from "../lib/borrow-limits.js";
import { invokeNotifier } from "../lib/invoke.js";
import {
  getItem,
  getReservation,
  putReservation,
  putReservationIfStatus,
  reservationRow,
} from "../lib/repo.js";
import type { AppEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth.js";
import { loadGarageContext } from "../middleware/garage-context.js";
import { idempotency } from "../middleware/idempotency.js";

export const reservationRoutes = new Hono<AppEnv>();

reservationRoutes.use("/v1/g/:garage/reservations", requireAuth(), loadGarageContext());
reservationRoutes.use("/v1/g/:garage/reservations/*", requireAuth(), loadGarageContext());

const ReservationCreateSchema = z.object({
  item_id: z.string().min(1),
  instance_id: z.string().min(1).optional(),
  start_at: z.iso.datetime({ offset: true }),
  end_at: z.iso.datetime({ offset: true }),
});

reservationRoutes.use("/v1/g/:garage/reservations", idempotency());
reservationRoutes.post("/v1/g/:garage/reservations", async (c) => {
  const garage = mustGarage(c);
  const user = mustUser(c);
  const membership = mustMembership(c);
  const body = ReservationCreateSchema.parse(await c.req.json());
  const item = await getItem(garage.id, body.item_id);
  if (!item) throw new ApiError("not_found", "Item not found");
  const access = resolveItemAccess(membership.tier, item.min_tier, item.auto_approve_tier);
  // Same answer as a missing item: tier-hidden items are not acknowledged.
  if (access === "hidden") throw new ApiError("not_found", "Item not found");
  const approvalRequired = access === "request" || item.requires_approval;
  const window = { start: Date.parse(body.start_at), end: Date.parse(body.end_at) };
  // Bounded like loans: an open-ended window held a unit indefinitely.
  assertReservationWindow(window);
  await assertNoOpenRequest(garage.id, item.id, user.phone);
  // Counted against the daily cap only once availability passed, just before
  // the row is written: refused requests do not use up the member's budget.
  const countRequest = () => bumpBorrowRequestCount(garage.id, user.phone);
  const build = (instanceId: string | undefined): Reservation => ({
    id: newId(),
    garage_id: garage.id,
    item_id: item.id,
    ...(instanceId ? { instance_id: instanceId } : {}),
    borrower_phone: user.phone,
    start_at: body.start_at,
    end_at: body.end_at,
    status: approvalRequired ? "pending" : "approved",
    approval_required: approvalRequired,
    source: "reserve",
  });
  const check = { item, instanceId: body.instance_id, borrowerPhone: user.phone, window };
  let reservation: Reservation;
  if (approvalRequired) {
    reservation = build(await assertAvailable({ ...check, commits: false }));
    await countRequest();
    await putReservation(reservation);
  } else {
    // An approved reservation takes a unit: commit it atomically.
    reservation = await commitAvailable(check, build, reservationRow, undefined, countRequest);
  }
  if (approvalRequired) {
    // The owner decides (POST /admin/reservations/:id/decide); the member hears then.
    await invokeNotifier({
      type: "borrow_request_pending",
      garage_id: garage.id,
      user_phone: garage.owner_phone,
      payload: { reservation_id: reservation.id, item_id: item.id, kind: "reservation" },
    });
  }
  return c.json({ reservation, created_at: nowIso() }, 201);
});

// DELETE /v1/g/:garage/reservations/:id — the borrower cancels their own
// pending or approved reservation (My Stuff "Cancel"). Cancelling frees the
// unit for others; it is a conditional write on the status that was read, so a
// concurrent owner decision wins or loses cleanly (409). Repeating the call on
// a cancelled reservation is a no-op.
reservationRoutes.delete("/v1/g/:garage/reservations/:id", async (c) => {
  const garage = mustGarage(c);
  const user = mustUser(c);
  const id = c.req.param("id");
  const existing = id ? await getReservation(garage.id, id) : undefined;
  // Someone else's reservation answers like a missing one.
  if (!existing || existing.borrower_phone !== user.phone) {
    throw new ApiError("not_found", "Reservation not found");
  }
  const {
    PK: _pk,
    SK: _sk,
    GSI1PK: _gpk,
    GSI1SK: _gsk,
    ...stored
  } = existing as Reservation & Record<string, unknown>;
  if (stored.status === "cancelled") return c.json({ reservation: stored });
  if (stored.status !== "pending" && stored.status !== "approved") {
    throw new ApiError("conflict", `Reservation is ${stored.status}`);
  }
  const cancelled: Reservation = {
    ...stored,
    status: "cancelled",
    cancelled_at: nowIso(),
    cancelled_by_phone: user.phone,
  };
  if (!(await putReservationIfStatus(cancelled, stored.status))) {
    throw new ApiError("conflict", "Reservation changed, reload and try again");
  }
  return c.json({ reservation: cancelled });
});
