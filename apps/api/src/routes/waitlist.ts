import { Hono } from "hono";

import { mustGarage, mustUser } from "../lib/ctx.js";
import { ApiError } from "../lib/errors.js";
import { deleteWaitlist, listWaitlist } from "../lib/repo.js";
import type { AppEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth.js";
import { loadGarageContext } from "../middleware/garage-context.js";

export const waitlistRoutes = new Hono<AppEnv>();

waitlistRoutes.use("/v1/g/:garage/waitlist/*", requireAuth(), loadGarageContext());

waitlistRoutes.delete("/v1/g/:garage/waitlist/:id", async (c) => {
  const garage = mustGarage(c);
  const user = mustUser(c);
  const id = c.req.param("id");
  if (!id) throw new ApiError("bad_request", "Missing id");
  // We don't index waitlist by entry id alone — the caller's id matches one
  // of their own entries, so we scan their items. Realistically the UI knows
  // the (item_id, joined_at) pair; here we accept the entry id and walk the
  // user's entries to find a match. Cheap for small lists; revisit if a user
  // ever has dozens of waitlist entries (unlikely in this domain).
  // We can't easily list all waitlist entries for a user without an extra
  // GSI; instead, iterate items the membership has touched. For now, do a
  // tenant-wide WAIT scan filtered by phone. Garages are small.
  const { ddb } = await import("../lib/ddb.js");
  const { QueryCommand } = await import("@aws-sdk/lib-dynamodb");
  const { env } = await import("../lib/env.js");
  const r = await ddb().send(
    new QueryCommand({
      TableName: env.tableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      FilterExpression: "id = :id AND borrower_phone = :phone",
      ExpressionAttributeValues: {
        ":pk": `TENANT#${garage.id}`,
        ":sk": "WAIT#",
        ":id": id,
        ":phone": user.phone,
      },
    }),
  );
  const found = r.Items?.[0] as
    | { item_id: string; joined_at: string; borrower_phone: string }
    | undefined;
  if (!found) throw new ApiError("not_found", "Waitlist entry not found");
  await deleteWaitlist(garage.id, found.item_id, found.joined_at, found.borrower_phone);
  // Renumber positions for remaining entries on this item.
  const remaining = await listWaitlist(garage.id, found.item_id);
  remaining.sort((a, b) => a.joined_at.localeCompare(b.joined_at));
  // Best-effort: do not re-write positions transactionally; on read, the
  // caller can recompute. We could renumber here but it's lossy under
  // contention. Skip for now.
  return c.json({ removed: true, item_id: found.item_id });
});
