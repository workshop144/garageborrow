import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { AppShell } from "../components/AppShell";
import { MemberCard } from "../components/Members/MemberCard";
import { useMembers } from "../hooks/useMembers";

export default function Members(): JSX.Element {
  const { garage } = useParams<{ garage: string }>();
  const query = useMembers(garage);
  const [search, setSearch] = useState("");

  const allMembers = useMemo(() => query.data?.pages.flatMap((p) => p.members) ?? [], [query.data]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allMembers;
    return allMembers.filter((m) => m.display_name.toLowerCase().includes(q));
  }, [allMembers, search]);

  return (
    <AppShell>
      <header className="mb-4">
        <h1 className="font-heading text-3xl text-gold-bright">Members</h1>
        <p className="text-sm opacity-70">Folks who borrow from this garage.</p>
      </header>

      <div className="mb-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name…"
          aria-label="Search members"
          className="w-full rounded-xl border border-workshop/20 dark:border-surface-light/20 bg-transparent px-3 py-2 text-sm"
          data-testid="members-search"
        />
      </div>

      {query.isLoading ? (
        <p className="text-sm opacity-70">Loading…</p>
      ) : query.isError ? (
        <p className="text-sm text-status-overdue">Couldn&apos;t load members.</p>
      ) : allMembers.length === 0 ? (
        <p className="rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-surface-light/60 dark:bg-workshop/40 p-6 text-center text-sm opacity-80">
          Nobody&apos;s here yet.
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-surface-light/60 dark:bg-workshop/40 p-6 text-center text-sm opacity-80">
          No matches.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="members-grid">
          {visible.map((m) => (
            <li key={`${m.display_name}-${m.phone_last4}`}>
              <MemberCard member={m} />
            </li>
          ))}
        </ul>
      )}

      {query.hasNextPage ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            data-testid="members-load-more"
            className="rounded-xl border border-workshop/20 dark:border-surface-light/20 px-4 py-2 text-sm hover:bg-workshop/5 dark:hover:bg-surface-light/5 disabled:opacity-60"
          >
            {query.isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </AppShell>
  );
}
