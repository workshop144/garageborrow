import { Hono } from "hono";
import type { Context, MiddlewareHandler, Next } from "hono";
import type { WishlistRequest } from "@garageborrow/shared";
import { z } from "zod";

import { mustGarage, mustUser } from "../lib/ctx.js";
import { ApiError } from "../lib/errors.js";
import { newId, nowIso } from "../lib/ids.js";
import { invokeNotifier } from "../lib/invoke.js";
import { paginate, parsePageParams } from "../lib/pagination.js";
import {
  bumpWishlistVoteCount,
  deleteWishlistVote,
  getUser,
  getUserAnyGarage,
  getWishlistRequest,
  getWishlistVote,
  listAllWishlistVotesForVoter,
  listWishlistRequests,
  listWishlistVotes,
  putWishlistRequest,
  putWishlistVote,
} from "../lib/repo.js";
import type { AppEnv } from "../lib/types.js";
import { audit, setAuditDetails } from "../middleware/audit.js";
import { requireAuth } from "../middleware/auth.js";
import { loadGarageContext } from "../middleware/garage-context.js";
import { idempotency } from "../middleware/idempotency.js";
import { ownerOnly } from "../middleware/owner-only.js";

export const wishlistRoutes = new Hono<AppEnv>();

// 404 every wishlist route when the garage has the feature disabled. Prevents
// list/detail/vote/decide from leaking once the owner flips the toggle off.
function wishlistEnabled(): MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next: Next) => {
    const garage = c.get("garage");
    if (!garage || garage.wishlist_enabled === false) {
      throw new ApiError("not_found", "Wishlist not available");
    }
    await next();
  };
}

// /me/wishlist is cross-garage and only needs the auth middleware. Mount it
// before the per-garage middleware so the :garage param checks don't fire.
wishlistRoutes.use("/v1/me/wishlist", requireAuth());
wishlistRoutes.get("/v1/me/wishlist", async (c) => {
  const user = mustUser(c);
  const params = parsePageParams(c);
  const primary = await getUserAnyGarage(user.phone);
  if (!primary) throw new ApiError("not_found", "User not found");
  type Mine = WishlistRequest & { my_vote: boolean };
  const all: Mine[] = [];
  for (const garageId of primary.garages_member_of) {
    const requests = await listWishlistRequests(garageId);
    const myVotes = await listAllWishlistVotesForVoter(garageId, user.phone);
    const mineRequestIds = new Set(myVotes.map((v) => v.request_id));
    for (const r of requests) {
      const isMine = r.requester_phone === user.phone;
      const iVoted = mineRequestIds.has(r.id);
      if (!isMine && !iVoted) continue;
      all.push({ ...r, my_vote: iVoted });
    }
  }
  all.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const { page, next_cursor } = paginate(all, params);
  return c.json(next_cursor ? { items: page, next_cursor } : { items: page });
});

// ─────────────────────── Member routes ───────────────────────
wishlistRoutes.use("/v1/g/:garage/wishlist", requireAuth(), loadGarageContext(), wishlistEnabled());
wishlistRoutes.use(
  "/v1/g/:garage/wishlist/*",
  requireAuth(),
  loadGarageContext(),
  wishlistEnabled(),
);

const ListStatusSchema = z.enum(["open", "acquired", "declined", "duplicate", "cancelled", "all"]);

wishlistRoutes.get("/v1/g/:garage/wishlist", async (c) => {
  const garage = mustGarage(c);
  const user = mustUser(c);
  const statusParam = c.req.query("status") ?? "open";
  const parsed = ListStatusSchema.safeParse(statusParam);
  if (!parsed.success) {
    throw new ApiError(
      "bad_request",
      "status must be one of open|acquired|declined|duplicate|cancelled|all",
    );
  }
  const params = parsePageParams(c);
  const all = await listWishlistRequests(garage.id);
  const filtered = parsed.data === "all" ? all : all.filter((r) => r.status === parsed.data);
  filtered.sort((a, b) => {
    if (b.vote_count !== a.vote_count) return b.vote_count - a.vote_count;
    return b.created_at.localeCompare(a.created_at);
  });
  const myVotes = await listAllWishlistVotesForVoter(garage.id, user.phone);
  const mineRequestIds = new Set(myVotes.map((v) => v.request_id));
  const decorated = filtered.map((r) => ({ ...r, my_vote: mineRequestIds.has(r.id) }));
  const { page, next_cursor } = paginate(decorated, params);
  return c.json(next_cursor ? { items: page, next_cursor } : { items: page });
});

const CreateRequestSchema = z
  .object({
    item_name: z.string().min(1).max(120),
    description: z.string().max(1000).optional(),
    desired_by: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    reason: z.string().max(500).optional(),
    reference_url: z.string().url().optional(),
    photo_url: z.string().min(1).optional(),
  })
  .strict();

wishlistRoutes.use("/v1/g/:garage/wishlist", idempotency());
wishlistRoutes.post("/v1/g/:garage/wishlist", audit(), async (c) => {
  const garage = mustGarage(c);
  const user = mustUser(c);
  const body = CreateRequestSchema.parse(await c.req.json());
  const ts = nowIso();
  const id = newId();
  const req: WishlistRequest = {
    id,
    garage_id: garage.id,
    requester_phone: user.phone,
    item_name: body.item_name,
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.desired_by !== undefined ? { desired_by: body.desired_by } : {}),
    ...(body.reason !== undefined ? { reason: body.reason } : {}),
    ...(body.reference_url !== undefined ? { reference_url: body.reference_url } : {}),
    ...(body.photo_url !== undefined ? { photo_url: body.photo_url } : {}),
    status: "open",
    vote_count: 1,
    created_at: ts,
    updated_at: ts,
  };
  await putWishlistRequest(req);
  // Atomic: requester's auto-vote is recorded as a WishlistVote alongside
  // the seed vote_count=1. Since it's a freshly created row, no second
  // writer can collide on the count for this id.
  await putWishlistVote(garage.id, {
    request_id: id,
    voter_phone: user.phone,
    voted_at: ts,
  });
  setAuditDetails(c, {
    action_type: "wishlist.created",
    entity_type: "wishlist_request",
    entity_id: id,
    before_snapshot: null,
    after_snapshot: req,
  });
  return c.json({ request: { ...req, my_vote: true } }, 201);
});

wishlistRoutes.get("/v1/g/:garage/wishlist/:id", async (c) => {
  const garage = mustGarage(c);
  const user = mustUser(c);
  const id = c.req.param("id");
  if (!id) throw new ApiError("bad_request", "Missing id");
  const req = await getWishlistRequest(garage.id, id);
  if (!req) throw new ApiError("not_found", "Wishlist request not found");
  const votes = await listWishlistVotes(garage.id, id);
  // Voter list respects each voter's visibility setting — hidden voters are
  // counted but not named.
  const voters: Array<{ phone: string; display_name: string | null }> = [];
  for (const v of votes) {
    const u = await getUser(garage.id, v.voter_phone);
    if (!u || u.visibility === "hidden") {
      voters.push({ phone: v.voter_phone, display_name: null });
    } else {
      voters.push({ phone: v.voter_phone, display_name: u.display_name });
    }
  }
  const requester = await getUser(garage.id, req.requester_phone);
  const requesterDisplay =
    !requester || requester.visibility === "hidden" ? null : requester.display_name;
  const myVote = votes.some((v) => v.voter_phone === user.phone);
  return c.json({
    request: { ...req, my_vote: myVote },
    voters,
    requester_display_name: requesterDisplay,
  });
});

wishlistRoutes.post("/v1/g/:garage/wishlist/:id/vote", async (c) => {
  const garage = mustGarage(c);
  const user = mustUser(c);
  const id = c.req.param("id");
  if (!id) throw new ApiError("bad_request", "Missing id");
  const req = await getWishlistRequest(garage.id, id);
  if (!req) throw new ApiError("not_found", "Wishlist request not found");
  if (req.status !== "open") {
    throw new ApiError("conflict", `Cannot vote on a ${req.status} request`);
  }
  const existing = await getWishlistVote(garage.id, id, user.phone);
  if (existing) {
    return c.json({ request: { ...req, my_vote: true }, vote_count: req.vote_count });
  }
  await putWishlistVote(garage.id, {
    request_id: id,
    voter_phone: user.phone,
    voted_at: nowIso(),
  });
  const newCount = await bumpWishlistVoteCount(req, 1);
  // Threshold-crossing fires the wishlist_popular ping exactly once. We
  // detect by comparing pre/post counts so subsequent votes don't re-fire.
  if (
    newCount >= garage.wishlist_popular_threshold &&
    req.vote_count < garage.wishlist_popular_threshold
  ) {
    await invokeNotifier({
      type: "wishlist_popular",
      garage_id: garage.id,
      user_phone: garage.owner_phone,
      payload: {
        request_id: id,
        item_name: req.item_name,
        vote_count: newCount,
      },
    });
  }
  return c.json({
    request: { ...req, vote_count: newCount, my_vote: true },
    vote_count: newCount,
  });
});

wishlistRoutes.delete("/v1/g/:garage/wishlist/:id/vote", async (c) => {
  const garage = mustGarage(c);
  const user = mustUser(c);
  const id = c.req.param("id");
  if (!id) throw new ApiError("bad_request", "Missing id");
  const req = await getWishlistRequest(garage.id, id);
  if (!req) throw new ApiError("not_found", "Wishlist request not found");
  const existing = await getWishlistVote(garage.id, id, user.phone);
  if (!existing) {
    return c.json({ request: { ...req, my_vote: false }, vote_count: req.vote_count });
  }
  await deleteWishlistVote(garage.id, id, user.phone);
  const newCount = await bumpWishlistVoteCount(req, -1);
  return c.json({
    request: { ...req, vote_count: newCount, my_vote: false },
    vote_count: newCount,
  });
});

wishlistRoutes.delete("/v1/g/:garage/wishlist/:id", audit(), async (c) => {
  const garage = mustGarage(c);
  const user = mustUser(c);
  const id = c.req.param("id");
  if (!id) throw new ApiError("bad_request", "Missing id");
  const req = await getWishlistRequest(garage.id, id);
  if (!req) throw new ApiError("not_found", "Wishlist request not found");
  const isRequester = req.requester_phone === user.phone;
  const isOwner = garage.owner_phone === user.phone;
  if (!isRequester && !isOwner) {
    throw new ApiError("forbidden", "Only the requester or owner can cancel");
  }
  if (req.status !== "open") {
    throw new ApiError("conflict", `Cannot cancel a ${req.status} request`);
  }
  const ts = nowIso();
  const cancelled: WishlistRequest = {
    ...req,
    status: "cancelled",
    decided_at: ts,
    decided_by_phone: user.phone,
    ...(isOwner && !isRequester ? { decline_reason: "owner cancelled" } : {}),
    updated_at: ts,
  };
  // Wipe GSI3 keys so the cancelled request drops out of the open-list view.
  await putWishlistRequest(cancelled);
  setAuditDetails(c, {
    action_type: "wishlist.cancelled",
    entity_type: "wishlist_request",
    entity_id: id,
    before_snapshot: req,
    after_snapshot: cancelled,
  });
  return c.json({ request: cancelled });
});

// ─────────────────────── Owner routes ───────────────────────

const DecideSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("acquired"),
    acquired_item_id: z.string().min(1),
  }),
  z.object({
    decision: z.literal("declined"),
    decline_reason: z.string().min(1).optional(),
  }),
  z.object({
    decision: z.literal("duplicate"),
    duplicate_of_id: z.string().min(1),
  }),
]);

wishlistRoutes.use(
  "/v1/g/:garage/admin/wishlist/:id/decide",
  requireAuth(),
  ownerOnly(),
  wishlistEnabled(),
  audit(),
  idempotency(),
);
wishlistRoutes.post("/v1/g/:garage/admin/wishlist/:id/decide", async (c) => {
  const garage = mustGarage(c);
  const user = mustUser(c);
  const id = c.req.param("id");
  if (!id) throw new ApiError("bad_request", "Missing id");
  const req = await getWishlistRequest(garage.id, id);
  if (!req) throw new ApiError("not_found", "Wishlist request not found");
  if (req.status !== "open") {
    throw new ApiError("conflict", `Already ${req.status}`);
  }
  const body = DecideSchema.parse(await c.req.json());
  const ts = nowIso();
  const votes = await listWishlistVotes(garage.id, id);
  const voterPhones = new Set(votes.map((v) => v.voter_phone));
  // Always notify the requester even if they didn't auto-vote.
  voterPhones.add(req.requester_phone);

  if (body.decision === "acquired") {
    const updated: WishlistRequest = {
      ...req,
      status: "acquired",
      acquired_item_id: body.acquired_item_id,
      decided_at: ts,
      decided_by_phone: user.phone,
      updated_at: ts,
    };
    await putWishlistRequest(updated);
    setAuditDetails(c, {
      action_type: "wishlist.acquired",
      entity_type: "wishlist_request",
      entity_id: id,
      before_snapshot: req,
      after_snapshot: updated,
    });
    for (const phone of voterPhones) {
      await invokeNotifier({
        type: "wishlist_acquired",
        garage_id: garage.id,
        user_phone: phone,
        payload: {
          request_id: id,
          item_name: req.item_name,
          acquired_item_id: body.acquired_item_id,
        },
      });
    }
    return c.json({ request: updated });
  }

  if (body.decision === "declined") {
    const updated: WishlistRequest = {
      ...req,
      status: "declined",
      ...(body.decline_reason ? { decline_reason: body.decline_reason } : {}),
      decided_at: ts,
      decided_by_phone: user.phone,
      updated_at: ts,
    };
    await putWishlistRequest(updated);
    setAuditDetails(c, {
      action_type: "wishlist.declined",
      entity_type: "wishlist_request",
      entity_id: id,
      before_snapshot: req,
      after_snapshot: updated,
    });
    await invokeNotifier({
      type: "wishlist_declined",
      garage_id: garage.id,
      user_phone: req.requester_phone,
      payload: {
        request_id: id,
        item_name: req.item_name,
        ...(body.decline_reason ? { reason: body.decline_reason } : {}),
      },
    });
    return c.json({ request: updated });
  }

  // duplicate — transfer votes to the canonical request.
  const canonical = await getWishlistRequest(garage.id, body.duplicate_of_id);
  if (!canonical) throw new ApiError("not_found", "Canonical request not found");
  if (canonical.id === req.id) {
    throw new ApiError("bad_request", "duplicate_of_id must reference a different request");
  }
  let transferred = 0;
  for (const v of votes) {
    const existing = await getWishlistVote(garage.id, canonical.id, v.voter_phone);
    if (existing) continue;
    await putWishlistVote(garage.id, {
      request_id: canonical.id,
      voter_phone: v.voter_phone,
      voted_at: ts,
    });
    transferred += 1;
  }
  if (transferred > 0) {
    await bumpWishlistVoteCount(canonical, transferred);
  }
  const updated: WishlistRequest = {
    ...req,
    status: "duplicate",
    duplicate_of_id: canonical.id,
    decided_at: ts,
    decided_by_phone: user.phone,
    updated_at: ts,
  };
  await putWishlistRequest(updated);
  setAuditDetails(c, {
    action_type: "wishlist.duplicated",
    entity_type: "wishlist_request",
    entity_id: id,
    before_snapshot: req,
    after_snapshot: { request: updated, transferred_votes: transferred },
  });
  for (const phone of voterPhones) {
    await invokeNotifier({
      type: "wishlist_duplicated",
      garage_id: garage.id,
      user_phone: phone,
      payload: {
        request_id: id,
        item_name: req.item_name,
        duplicate_of_id: canonical.id,
      },
    });
  }
  return c.json({ request: updated, transferred_votes: transferred });
});
