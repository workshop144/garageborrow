import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { ComingSoonCard } from "../components/AI/ComingSoonCard";
import { FilterBar } from "../components/Pegboard/FilterBar";
import type { Filters } from "../components/Pegboard/FilterBar";
import { PegboardGrid } from "../components/Pegboard/PegboardGrid";
import { useGarageItems } from "../hooks/useGarageItems";
import type { GarageItem } from "../hooks/useGarageItems";
import { useGarageProfile } from "../hooks/useGarageProfile";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { useMe } from "../lib/hooks/useMe";

const INITIAL_FILTERS: Filters = {
  query: "",
  category: null,
  availableOnly: false,
  sort: "recent",
};

function isAvailable(item: GarageItem): boolean {
  return item.status === "available" || item.status === "partial_loaned";
}

function applyFilters(items: GarageItem[], filters: Filters): GarageItem[] {
  const q = filters.query.trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (filters.category && item.category !== filters.category) return false;
    if (filters.availableOnly && !isAvailable(item)) return false;
    if (q) {
      const haystack = [item.name, item.description, ...(item.tags ?? [])].join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const sorted = [...filtered];
  if (filters.sort === "az") {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else if (filters.sort === "popular") {
    // Borrow count not yet on list response; fall back to recently added.
    sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
  } else {
    sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  return sorted;
}

export default function Pegboard(): JSX.Element {
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const query = useGarageItems();
  const me = useMe();
  const garage = useGarageProfile();
  // Family-only "Ask Dad's Garage" placeholder. Hidden once the owner flips
  // ai_enabled — at that point this slot becomes the launcher for an actual
  // chat input (deferred to v1.5).
  const showAiCard = me.data?.tier === "family" && garage.data?.ai_enabled === false;
  const items = useMemo(() => query.data ?? [], [query.data]);

  const { pull, refreshing } = usePullToRefresh({
    onRefresh: () => query.refetch(),
  });

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) set.add(it.category);
    return Array.from(set).sort();
  }, [items]);

  const visible = useMemo(() => applyFilters(items, filters), [items, filters]);

  return (
    <AppShell>
      <div
        className="relative"
        style={{
          transform: `translateY(${pull}px)`,
          transition: pull === 0 ? "transform 200ms ease-out" : undefined,
        }}
      >
        {pull > 8 || refreshing ? (
          <div className="absolute -top-8 left-0 right-0 flex justify-center text-xs opacity-70">
            {refreshing ? "Refreshing…" : "Pull to refresh"}
          </div>
        ) : null}
        <header className="mb-4">
          <h1 className="font-heading text-3xl text-gold-bright">The Pegboard</h1>
          <p className="text-sm opacity-70">Tap a tool to borrow it.</p>
        </header>

        <div className="mb-4">
          <FilterBar filters={filters} onChange={setFilters} categories={categories} />
        </div>

        {showAiCard ? (
          <div className="mb-4">
            <ComingSoonCard />
          </div>
        ) : null}

        {query.isLoading ? (
          <div className="rounded-lg border border-workshop/10 dark:border-surface-light/10 p-8 text-center text-sm opacity-70">
            Loading the pegboard…
          </div>
        ) : query.isError ? (
          <div className="rounded-lg border border-status-overdue/40 bg-status-overdue/10 p-6 text-center text-sm">
            Couldn&apos;t load the pegboard. Pull to refresh, or try again later.
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="Dad hasn't put anything on the pegboard yet."
            body="Check back soon."
          />
        ) : visible.length === 0 ? (
          <div className="space-y-3">
            <EmptyState title="Nothing matches that." body="Try a different filter." />
            {garage.data?.wishlist_enabled !== false ? (
              <div
                className="rounded-lg border border-gold-bright/40 bg-gold-bright/10 p-4 text-center text-sm"
                data-testid="pegboard-wishlist-cta"
              >
                Not finding it?{" "}
                <Link
                  to={`/wishlist?create=1${
                    filters.query ? `&name=${encodeURIComponent(filters.query)}` : ""
                  }`}
                  className="font-semibold underline"
                >
                  Add to wishlist
                </Link>
              </div>
            ) : null}
          </div>
        ) : (
          <PegboardGrid items={visible} />
        )}
      </div>
    </AppShell>
  );
}

function EmptyState({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-workshop/15 dark:border-surface-light/10 bg-surface-light/60 dark:bg-workshop/40 p-8 text-center">
      <p className="font-heading text-xl">{title}</p>
      <p className="mt-2 text-sm opacity-70">{body}</p>
    </div>
  );
}
