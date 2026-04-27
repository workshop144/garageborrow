import { useMemo, useState } from "react";

import { AdminLayout } from "../../components/Admin/AdminLayout";
import { useGarageItems } from "../../hooks/useGarageItems";
import { useWishlist, type WishlistFilter, type WishlistRow } from "../../hooks/useWishlist";
import { useWishlistDecision } from "../../hooks/useWishlistDecision";
import { safeHref } from "../../lib/safeHref";

type Sort = "votes" | "date" | "desired";

const FILTERS: WishlistFilter[] = ["open", "acquired", "declined", "duplicate", "all"];

export default function AdminWishlist(): JSX.Element {
  const [filter, setFilter] = useState<WishlistFilter>("open");
  const [sort, setSort] = useState<Sort>("votes");
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const list = useWishlist(undefined, filter);

  const items = useMemo<WishlistRow[]>(() => {
    const raw = (list.data?.pages ?? []).flatMap((p) => p.items);
    const sorted = [...raw];
    if (sort === "votes") {
      sorted.sort((a, b) => b.vote_count - a.vote_count);
    } else if (sort === "date") {
      sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    } else {
      // Desired-by asc; rows without a date go last.
      sorted.sort((a, b) => {
        if (!a.desired_by && !b.desired_by) return 0;
        if (!a.desired_by) return 1;
        if (!b.desired_by) return -1;
        return a.desired_by.localeCompare(b.desired_by);
      });
    }
    return sorted;
  }, [list.data, sort]);

  const stats = useMemo(() => {
    const all = (list.data?.pages ?? []).flatMap((p) => p.items);
    const open = all.filter((r) => r.status === "open").length;
    const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
    const acquiredThisMonth = all.filter(
      (r) => r.status === "acquired" && (r.decided_at ?? "") >= monthAgo,
    ).length;
    const top = [...all].sort((a, b) => b.vote_count - a.vote_count)[0];
    return { open, acquiredThisMonth, top };
  }, [list.data]);

  const drawerRow = drawerId ? (items.find((r) => r.id === drawerId) ?? null) : null;

  return (
    <AdminLayout>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl text-gold-bright">Wishlist</h1>
          <p className="mt-1 text-sm opacity-70">
            What members are asking for, and what to grab next.
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-3 text-xs">
          <Stat label="Open" value={String(stats.open)} />
          <Stat label="Acquired (30d)" value={String(stats.acquiredThisMonth)} />
          <Stat
            label="Top voted"
            value={stats.top ? `${stats.top.item_name} (${stats.top.vote_count})` : "—"}
          />
        </dl>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide">
        <span className="opacity-70">Filter:</span>
        {FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`rounded-md px-2 py-1 ${
              filter === s
                ? "bg-gold-bright text-workshop font-semibold"
                : "bg-workshop/5 dark:bg-surface-light/5"
            }`}
          >
            {s}
          </button>
        ))}
        <span className="ml-3 opacity-70">Sort:</span>
        {(["votes", "date", "desired"] as Sort[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSort(s)}
            className={`rounded-md px-2 py-1 ${
              sort === s
                ? "bg-gold-bright text-workshop font-semibold"
                : "bg-workshop/5 dark:bg-surface-light/5"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {list.isLoading ? (
        <p className="text-sm opacity-70">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm opacity-70">Nothing here.</p>
      ) : (
        <table className="w-full table-auto text-sm" data-testid="admin-wishlist-table">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide opacity-70">
              <th className="py-2">Item</th>
              <th className="py-2">Votes</th>
              <th className="py-2">By</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer border-t border-workshop/10 dark:border-surface-light/10"
                onClick={() => setDrawerId(r.id)}
                data-testid={`admin-wishlist-row-${r.id}`}
              >
                <td className="py-2 pr-2">{r.item_name}</td>
                <td className="py-2 pr-2 tabular-nums">{r.vote_count}</td>
                <td className="py-2 pr-2 opacity-70">{r.desired_by ?? "—"}</td>
                <td className="py-2 pr-2">{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
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

      {drawerRow ? <DecisionDrawer row={drawerRow} onClose={() => setDrawerId(null)} /> : null}
    </AdminLayout>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-workshop/10 dark:border-surface-light/10 px-3 py-2">
      <dt className="opacity-70">{label}</dt>
      <dd className="font-heading text-base">{value}</dd>
    </div>
  );
}

type DecisionMode = "acquired" | "declined" | "duplicate" | null;

function DecisionDrawer({ row, onClose }: { row: WishlistRow; onClose: () => void }): JSX.Element {
  const [mode, setMode] = useState<DecisionMode>(null);
  const [acquiredItemId, setAcquiredItemId] = useState("");
  const [declineReason, setDeclineReason] = useState("");
  const [duplicateOfId, setDuplicateOfId] = useState("");
  const decide = useWishlistDecision();
  const items = useGarageItems();
  const allOtherWishes = useWishlist(undefined, "open");

  function submit(): void {
    if (mode === "acquired") {
      decide.mutate(
        { id: row.id, decision: "acquired", acquired_item_id: acquiredItemId },
        { onSuccess: onClose },
      );
    } else if (mode === "declined") {
      decide.mutate(
        {
          id: row.id,
          decision: "declined",
          ...(declineReason ? { decline_reason: declineReason } : {}),
        },
        { onSuccess: onClose },
      );
    } else if (mode === "duplicate") {
      decide.mutate(
        { id: row.id, decision: "duplicate", duplicate_of_id: duplicateOfId },
        { onSuccess: onClose },
      );
    }
  }

  const otherWishes = (allOtherWishes.data?.pages ?? [])
    .flatMap((p) => p.items)
    .filter((r) => r.id !== row.id);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Decide wishlist request"
      data-testid="admin-wishlist-drawer"
      className="fixed inset-0 z-50 flex justify-end bg-workshop/60"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div className="relative w-full max-w-md overflow-y-auto bg-surface-light p-4 dark:bg-workshop">
        <header className="mb-4 flex items-start justify-between gap-3">
          <h2 className="font-heading text-xl">{row.item_name}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-full p-2 opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </header>

        <p className="mb-2 text-sm opacity-80">
          {row.vote_count} {row.vote_count === 1 ? "vote" : "votes"} ·{" "}
          {row.desired_by ? `needs by ${row.desired_by}` : "no rush"}
        </p>
        {row.description ? <p className="mb-3 text-sm">{row.description}</p> : null}
        {row.reference_url && safeHref(row.reference_url) ? (
          <p className="mb-3 break-all text-xs">
            <a
              href={safeHref(row.reference_url)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {row.reference_url}
            </a>
          </p>
        ) : null}

        {row.status === "open" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMode("acquired")}
                className="rounded-xl border border-workshop/15 dark:border-surface-light/15 px-3 py-2 text-sm"
                data-testid="admin-wishlist-mark-acquired"
              >
                Mark as acquired
              </button>
              <button
                type="button"
                onClick={() => setMode("declined")}
                className="rounded-xl border border-workshop/15 dark:border-surface-light/15 px-3 py-2 text-sm"
                data-testid="admin-wishlist-decline"
              >
                Decline
              </button>
              <button
                type="button"
                onClick={() => setMode("duplicate")}
                className="rounded-xl border border-workshop/15 dark:border-surface-light/15 px-3 py-2 text-sm"
                data-testid="admin-wishlist-mark-duplicate"
              >
                Mark as duplicate
              </button>
            </div>

            {mode === "acquired" ? (
              <label className="block text-sm">
                <span className="block font-semibold">Pick the resulting item</span>
                <select
                  value={acquiredItemId}
                  onChange={(e) => setAcquiredItemId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
                  data-testid="admin-wishlist-acquired-select"
                >
                  <option value="">— select an item —</option>
                  {(items.data ?? []).map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {mode === "declined" ? (
              <label className="block text-sm">
                <span className="block font-semibold">Reason (optional)</span>
                <textarea
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
                  data-testid="admin-wishlist-decline-reason"
                />
              </label>
            ) : null}

            {mode === "duplicate" ? (
              <label className="block text-sm">
                <span className="block font-semibold">Canonical request</span>
                <select
                  value={duplicateOfId}
                  onChange={(e) => setDuplicateOfId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
                  data-testid="admin-wishlist-duplicate-select"
                >
                  <option value="">— select an open request —</option>
                  {otherWishes.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.item_name} ({w.vote_count})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {decide.error ? (
              <p className="rounded-xl border border-status-overdue/40 bg-status-overdue/10 p-3 text-sm">
                {decide.error.message}
              </p>
            ) : null}

            {mode ? (
              <button
                type="button"
                onClick={submit}
                disabled={
                  decide.isPending ||
                  (mode === "acquired" && !acquiredItemId) ||
                  (mode === "duplicate" && !duplicateOfId)
                }
                className="w-full rounded-xl bg-gold-bright px-4 py-2 text-sm font-semibold text-workshop disabled:opacity-50"
                data-testid="admin-wishlist-submit"
              >
                {decide.isPending ? "Saving…" : "Submit decision"}
              </button>
            ) : null}
          </div>
        ) : (
          <p className="text-sm opacity-70">Already {row.status}.</p>
        )}
      </div>
    </div>
  );
}
