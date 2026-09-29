import { Hono } from "hono";
import { resolveItemAccess } from "@garageborrow/shared";
import type { Reservation } from "@garageborrow/shared";
import { z } from "zod";

import { mustGarage, mustMembership, mustUser } from "../lib/ctx.js";
import { ApiError } from "../lib/errors.js";
import { newId, nowIso } from "../lib/ids.js";
import { assertAvailable, commitAvailable } from "../lib/availability.js";
import { invokeNotifier } from "../lib/invoke.js";
import { getItem, putReservation, reservationRow } from "../lib/repo.js";
import type { AppEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth.js";
import { loadGarageContext } from "../middleware/garage-context.js";
import { idempotency } from "../middleware/idempotency.js";

export const reservationRoutes = new Hono<AppEnv>();

reservationRoutes.use("/v1/g/:garage/reservations", requireAuth(), loadGarageContext());

const ReservationCreateSchema = z.object({
  item_id: z.string().min(1),
  instance_id: z.string().min(1).optional(),
  start_at: z.string().datetime({ offset: true }),
  end_at: z.string().datetime({ offset: true }),
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
  });
  const check = { item, instanceId: body.instance_id, borrowerPhone: user.phone, window };
  let reservation: Reservation;
  if (approvalRequired) {
    reservation = build(await assertAvailable({ ...check, commits: false }));
    await putReservation(reservation);
  } else {
    // An approved reservation takes a unit: commit it atomically.
    reservation = await commitAvailable(check, build, reservationRow);
  }
  if (approvalRequired) {
    await invokeNotifier({
      type: "reservation_decided",
      garage_id: garage.id,
      user_phone: user.phone,
      payload: { reservation_id: reservation.id, status: "pending" },
    });
  }
  return c.json({ reservation, created_at: nowIso() }, 201);
});
