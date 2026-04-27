import { useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { AppShell } from "../components/AppShell";
import { RequestModal } from "../components/Wishlist/RequestModal";
import { useWishlist, type WishlistFilter, type WishlistRow } from "../hooks/useWishlist";
import { useWishlistVote } from "../hooks/useWishlistVote";
import { useGarageProfile } from "../hooks/useGarageProfile";
import { formatRelative } from "../lib/dates";

const HERO =
  "Looking for something we don't have? Add it. Vote on what others want. Dad keeps an eye on the list.";

export default function Wishlist(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const initialFilter = (params.get("status") as WishlistFilter) ?? "open";
  const [filter, setFilter] = useState<WishlistFilter>(initialFilter);
  const [modalOpen, setModalOpen] = useState(params.get("create") === "1");
  const initialName = params.get("name") ?? undefined;

  const garage = useGarageProfile();
  const list = useWishlist(undefined, filter);
  const vote = useWishlistVote();

  const items = useMemo<WishlistRow[]>(
    () => (list.data?.pages ?? []).flatMap((p) => p.items),
    [list.data],
  );

  if (garage.data && garage.data.wishlist_enabled === false) {
    return <Navigate to="/" replace />;
  }

  function setStatus(s: WishlistFilter) {
    setFilter(s);
    const next = new URLSearchParams(params);
    next.set("status", s);
    setParams(next, { replace: true });
  }

  return (
    <AppShell>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl text-gold-bright">The Wishlist</h1>
          <p className="mt-1 text-sm opacity-80">{HERO}</p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="shrink-0 rounded-xl bg-gold-bright px-3 py-2 text-sm font-semibold text-workshop"
          data-testid="wishlist-open-modal"
        >
          Request something new
        </button>
      </header>

      <div
        role="tablist"
        aria-label="Wishlist filter"
        className="mb-4 flex gap-1 text-xs uppercase tracking-wide"
      >
        {(["open", "acquired", "all"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={filter === s}
            onClick={() => setStatus(s)}
            className={`rounded-md px-3 py-1.5 ${
              filter === s
                ? "bg-gold-bright text-workshop font-semibold"
                : "bg-workshop/5 dark:bg-surface-light/5"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {list.isLoading ? (
        <div className="rounded-lg border border-workshop/10 dark:border-surface-light/10 p-8 text-center text-sm opacity-70">
          Loading the wishlist…
        </div>
      ) : list.isError ? (
        <div className="rounded-lg border border-status-overdue/40 bg-status-overdue/10 p-6 text-center text-sm">
          Couldn&apos;t load the wishlist. Try again later.
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-workshop/15 dark:border-surface-light/10 bg-surface-light/60 dark:bg-workshop/40 p-8 text-center">
          <p className="font-heading text-xl">Nothing here yet.</p>
          <p className="mt-2 text-sm opacity-70">Be the first to ask for something.</p>
        </div>
      ) : (
        <ul className="space-y-3" data-testid="wishlist-list">
          {items.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-workshop/10 dark:border-surface-light/10 bg-surface-light/60 dark:bg-workshop/40 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <Link to={`/wishlist/${r.id}`} className="min-w-0 flex-1">
                  <h2 className="font-heading text-xl break-words">{r.item_name}</h2>
                  {r.description ? (
                    <p className="mt-1 text-sm opacity-80 line-clamp-2">
                      {r.description.slice(0, 120)}
                      {r.description.length > 120 ? "…" : ""}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs opacity-70">
                    {formatRelative(r.created_at)}
                    {r.desired_by ? ` · needed by ${r.desired_by}` : ""}
                  </p>
                </Link>
                <button
                  type="button"
                  onClick={() => vote.mutate({ id: r.id, voted: r.my_vote })}
                  disabled={vote.isPending}
                  aria-pressed={r.my_vote}
                  data-testid={`wishlist-vote-${r.id}`}
                  className={`flex shrink-0 flex-col items-center justify-center rounded-xl border px-3 py-2 text-sm transition-colors ${
                    r.my_vote
                      ? "border-gold-bright bg-gold-bright text-workshop"
                      : "border-workshop/15 dark:border-surface-light/15"
                  }`}
                >
                  <span aria-hidden className="text-base leading-none">
                    {r.my_vote ? "♥" : "♡"}
                  </span>
                  <span className="text-xs font-semibold tabular-nums">{r.vote_count}</span>
                </button>
              </div>
              {r.photo_url ? (
                <img
                  src={`/img/${r.photo_url}`}
                  alt=""
                  className="mt-3 h-20 w-20 rounded-lg object-cover"
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {list.hasNextPage ? (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => list.fetchNextPage()}
            disabled={list.isFetchingNextPage}
            className="rounded-xl border border-workshop/15 dark:border-surface-light/15 px-4 py-2 text-sm"
          >
            {list.isFetchingNextPage ? "Loading…" : "Show more"}
          </button>
        </div>
      ) : null}

      <RequestModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        {...(initialName ? { initialName } : {})}
      />
    </AppShell>
  );
}
