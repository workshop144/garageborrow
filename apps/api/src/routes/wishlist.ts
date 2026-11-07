import { Hono } from "hono";
import type { Context, MiddlewareHandler, Next } from "hono";
import { HttpUrl } from "@garageborrow/shared";
import type { User, WishlistRequest } from "@garageborrow/shared";
import { z } from "zod";

import { mustGarage, mustUser } from "../lib/ctx.js";
import { ApiError } from "../lib/errors.js";
import { newId, nowIso } from "../lib/ids.js";
import { invokeNotifier } from "../lib/invoke.js";
import { paginate, parsePageParams } from "../lib/pagination.js";
import { PhotoKey } from "../lib/photo-key.js";
import {
  bumpWindowCounter,
  bumpWishlistVoteCount,
  closeWishlistRequest,
  deleteWishlistVote,
  getGarage,
  getItem,
  getUser,
  getUserAnyGarage,
  getWishlistRequest,
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
// Directory policy: the garage owner and the member themselves see full
// numbers. Other members see the last 4 digits, and only of a member that GET
// /members would list (visible and not pending deletion). A hidden, deleted or
// missing member shows no digits and no name, so the wishlist cannot link a
// hidden member's activity to a phone number.
function isListedProfile(u: User | undefined): u is User {
  return !!u && u.visibility === "visible" && !u.deleted_at;
}

type ProfileLookup = (garageId: string, phone: string) => Promise<User | undefined>;

// Per-request memo so a list of requests by the same few members reads each
// profile once.
function profileLookup(): ProfileLookup {
  const seen = new Map<string, Promise<User | undefined>>();
  return (garageId, phone) => {
    const key = `${garageId}#${phone}`;
    let hit = seen.get(key);
    if (!hit) {
      hit = getUser(garageId, phone);
      seen.set(key, hit);
    }
    return hit;
  };
}

async function maskPhone(
  phone: string,
  garageId: string,
  viewer: string,
  isOwner: boolean,
  lookup: ProfileLookup,
): Promise<string | null> {
  if (isOwner || phone === viewer) return phone;
  const u = await lookup(garageId, phone);
  return isListedProfile(u) ? `***${phone.slice(-4)}` : null;
}

type MemberView<T> = Omit<T, "requester_phone" | "decided_by_phone"> & {
  requester_phone: string | null;
  decided_by_phone?: string | null;
};

async function forViewer<
  T extends Pick<WishlistRequest, "garage_id" | "requester_phone" | "decided_by_phone">,
>(
  req: T,
  viewer: string,
  isOwner: boolean,
  lookup: ProfileLookup = profileLookup(),
): Promise<MemberView<T>> {
  const { requester_phone, decided_by_phone, ...rest } = req;
  const out: MemberView<T> = {
    ...rest,
    requester_phone: await maskPhone(requester_phone, req.garage_id, viewer, isOwner, lookup),
  };
  if (decided_by_phone !== undefined) {
    out.decided_by_phone = await maskPhone(
      decided_by_phone,
      req.garage_id,
      viewer,
      isOwner,
      lookup,
    );
  }
  return out;
}

wishlistRoutes.get("/v1/me/wishlist", async (c) => {
  const user = mustUser(c);
  const params = parsePageParams(c);
  const primary = await getUserAnyGarage(user.phone);
  if (!primary) throw new ApiError("not_found", "User not found");
  const lookup = profileLookup();
  const ownerOf = new Set<string>();
  const all: Array<WishlistRequest & { my_vote: boolean }> = [];
  for (const garageId of primary.garages_member_of) {
    const [garage, requests, myVotes] = await Promise.all([
      getGarage(garageId),
      listWishlistRequests(garageId),
      listAllWishlistVotesForVoter(garageId, user.phone),
    ]);
    // The garage owner sees full numbers here too, as on the per-garage list.
    if (garage?.owner_phone === user.phone) ownerOf.add(garageId);
    const mineRequestIds = new Set(myVotes.map((v) => v.request_id));
    for (const r of requests) {
      const isMine = r.requester_phone === user.phone;
      const iVoted = mineRequestIds.has(r.id);
      if (!isMine && !iVoted) continue;
      all.push({ ...r, my_vote: iVoted });
    }
  }
  all.sort((a, b) => b.created_at.localeCompare(a.created_at));
  // Decorate only the returned page: each distinct phone costs a profile read.
  const { page, next_cursor } = paginate(all, params);
  const items = await Promise.all(
    page.map((r) => forViewer(r, user.phone, ownerOf.has(r.garage_id), lookup)),
  );
  return c.json(next_cursor ? { items, next_cursor } : { items });
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
  const isOwner = garage.owner_phone === user.phone;
  const lookup = profileLookup();
  // Decorate only the returned page: each distinct phone costs a profile read.
  const { page, next_cursor } = paginate(filtered, params);
  const items = await Promise.all(
    page.map((r) =>
      forViewer({ ...r, my_vote: mineRequestIds.has(r.id) }, user.phone, isOwner, lookup),
    ),
  );
  return c.json(next_cursor ? { items, next_cursor } : { items });
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
    reference_url: HttpUrl.optional(),
    // An uploads/ key from /v1/uploads/sign, rendered as /img/<key>. The shared
    // PhotoKey rejects dot segments, which would let the key escape /img/.
    photo_url: PhotoKey.optional(),
  })
  .strict();

// Requests per member per UTC day: far above real use, but it bounds how many
// rows (and owner notifications) one account can add.
export const MAX_WISHLIST_CREATES_PER_DAY = 20;

wishlistRoutes.use("/v1/g/:garage/wishlist", idempotency());
wishlistRoutes.post("/v1/g/:garage/wishlist", audit(), async (c) => {
  const garage = mustGarage(c);
  const user = mustUser(c);
  const body = CreateRequestSchema.parse(await c.req.json());
  const ts = nowIso();
  const created = await bumpWindowCounter(
    "wishlist-create",
    user.phone,
    ts.slice(0, 10),
    Math.floor(Date.parse(ts) / 1000) + 2 * 86400,
  );
  if (created > MAX_WISHLIST_CREATES_PER_DAY) {
    throw new ApiError("rate_limited", "Daily wishlist limit reached; try again tomorrow");
  }
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
  const isOwner = garage.owner_phone === user.phone;
  const lookup = profileLookup();
  // Voter list follows each voter's visibility: a hidden, deleted or missing
  // voter is counted but shows no name, and to other members no phone digits.
  // The garage owner sees every name and number, as in the member directory.
  const voters = await Promise.all(
    votes.map(async (v) => {
      const u = await lookup(garage.id, v.voter_phone);
      const phone = await maskPhone(v.voter_phone, garage.id, user.phone, isOwner, lookup);
      const named = u && (isOwner || isListedProfile(u) || v.voter_phone === user.phone);
      return { phone, display_name: named ? u.display_name : null };
    }),
  );
  const requester = await lookup(garage.id, req.requester_phone);
  const requesterDisplay =
    requester && (isOwner || isListedProfile(requester) || req.requester_phone === user.phone)
      ? requester.display_name
      : null;
  const myVote = votes.some((v) => v.voter_phone === user.phone);
  return c.json({
    request: await forViewer({ ...req, my_vote: myVote }, user.phone, isOwner, lookup),
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
  const recorded = await putWishlistVote(garage.id, {
    request_id: id,
    voter_phone: user.phone,
    voted_at: nowIso(),
  });
  if (!recorded) {
    return c.json({
      request: await forViewer(
        { ...req, my_vote: true },
        user.phone,
        garage.owner_phone === user.phone,
      ),
      vote_count: req.vote_count,
    });
  }
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
    request: await forViewer(
      { ...req, vote_count: newCount, my_vote: true },
      user.phone,
      garage.owner_phone === user.phone,
    ),
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
  if (!(await deleteWishlistVote(garage.id, id, user.phone))) {
    return c.json({
      request: await forViewer(
        { ...req, my_vote: false },
        user.phone,
        garage.owner_phone === user.phone,
      ),
      vote_count: req.vote_count,
    });
  }
  const newCount = await bumpWishlistVoteCount(req, -1);
  return c.json({
    request: await forViewer(
      { ...req, vote_count: newCount, my_vote: false },
      user.phone,
      garage.owner_phone === user.phone,
    ),
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
  // Conditional on still open, and only the decision fields (review F5).
  const cancelled = await closeWishlistRequest(req, {
    status: "cancelled",
    decided_at: ts,
    decided_by_phone: user.phone,
    ...(isOwner && !isRequester ? { decline_reason: "owner cancelled" } : {}),
    updated_at: ts,
  });
  if (!cancelled) throw new ApiError("conflict", "Request is no longer open");
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

  // Each branch closes the request with one conditional update before it
  // notifies anyone: a concurrent cancel or second decision gets a 409 and
  // sends nothing, and vote_count is never rewritten (review F5).
  if (body.decision === "acquired") {
    // The item the wish became must exist in this garage.
    if (!(await getItem(garage.id, body.acquired_item_id))) {
      throw new ApiError("bad_request", "acquired_item_id is not an item in this garage");
    }
    const updated = await closeWishlistRequest(req, {
      status: "acquired",
      acquired_item_id: body.acquired_item_id,
      decided_at: ts,
      decided_by_phone: user.phone,
      updated_at: ts,
    });
    if (!updated) throw new ApiError("conflict", "Request is no longer open");
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
    const updated = await closeWishlistRequest(req, {
      status: "declined",
      ...(body.decline_reason ? { decline_reason: body.decline_reason } : {}),
      decided_at: ts,
      decided_by_phone: user.phone,
      updated_at: ts,
    });
    if (!updated) throw new ApiError("conflict", "Request is no longer open");
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
  // Votes move only to a request that can still be acquired.
  if (canonical.status !== "open") {
    throw new ApiError("conflict", `Canonical request is ${canonical.status}`);
  }
  const updated = await closeWishlistRequest(req, {
    status: "duplicate",
    duplicate_of_id: canonical.id,
    decided_at: ts,
    decided_by_phone: user.phone,
    updated_at: ts,
  });
  if (!updated) throw new ApiError("conflict", "Request is no longer open");
  let transferred = 0;
  for (const v of votes) {
    const recorded = await putWishlistVote(garage.id, {
      request_id: canonical.id,
      voter_phone: v.voter_phone,
      voted_at: ts,
    });
    if (recorded) transferred += 1;
  }
  if (transferred > 0) {
    await bumpWishlistVoteCount(canonical, transferred);
  }
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
