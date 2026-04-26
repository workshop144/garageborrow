import { useMemo, useState } from "react";

import { AdminLayout } from "../../components/Admin/AdminLayout";
import { CsvImportModal } from "../../components/Admin/Inventory/CsvImportModal";
import { ItemEditDrawer } from "../../components/Admin/Inventory/ItemEditDrawer";
import type { AdminItem } from "../../hooks/useAdminItems";
import { useAdminItems } from "../../hooks/useAdminItems";

const STATUS_PILL: Record<string, string> = {
  available: "bg-status-available/20 text-status-available",
  partial_loaned: "bg-status-out/20 text-status-out",
  all_loaned: "bg-status-out/20 text-status-out",
  broken: "bg-status-overdue/20 text-status-overdue",
  maintenance: "bg-workshop/10 dark:bg-surface-light/10",
  retired: "bg-workshop/10 dark:bg-surface-light/10 opacity-70",
  lost: "bg-status-overdue/20 text-status-overdue",
};

export default function Inventory(): JSX.Element {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string>("");
  const [editing, setEditing] = useState<AdminItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);

  const items = useAdminItems({
    q: q || undefined,
    category: category || undefined,
    sort: "alphabetical",
  });

  const allItems = useMemo(() => items.data?.pages.flatMap((p) => p.items) ?? [], [items.data]);
  const knownCategories = useMemo(
    () => Array.from(new Set(allItems.map((i) => i.category))).sort(),
    [allItems],
  );

  function openEdit(item: AdminItem | null): void {
    setEditing(item);
    setDrawerOpen(true);
  }

  return (
    <AdminLayout>
      <header className="mb-4">
        <h1 className="font-heading text-3xl text-gold-bright">Inventory</h1>
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="search"
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1 min-w-[10rem] rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent px-3 py-2 text-sm"
          data-testid="inventory-search"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent px-3 py-2 text-sm"
        >
          <option value="">All categories</option>
          {knownCategories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setCsvOpen(true)}
          className="rounded-xl border border-workshop/15 dark:border-surface-light/15 px-3 py-2 text-sm"
          data-testid="inventory-csv-open"
        >
          Import CSV
        </button>
      </div>

      {items.isLoading ? (
        <p className="opacity-70">Loading…</p>
      ) : allItems.length === 0 ? (
        <p className="opacity-70">No tools yet — tap the + button to add one.</p>
      ) : (
        <ul className="divide-y divide-workshop/10 dark:divide-surface-light/10 rounded-2xl border border-workshop/15 dark:border-surface-light/15">
          {allItems.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                onClick={() => openEdit(it)}
                className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-workshop/5 dark:hover:bg-surface-light/5"
              >
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-workshop/10 dark:bg-surface-light/10">
                  {it.primary_photo_key ? (
                    <span className="block h-full w-full bg-workshop/10 dark:bg-surface-light/10" />
                  ) : null}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate font-semibold">{it.name}</p>
                  <p className="text-xs opacity-70">
                    {it.category} · {it.total_count} unit{it.total_count === 1 ? "" : "s"}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${STATUS_PILL[it.status] ?? ""}`}
                >
                  {it.status.replace("_", " ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {items.hasNextPage ? (
        <button
          type="button"
          onClick={() => void items.fetchNextPage()}
          disabled={items.isFetchingNextPage}
          className="mt-4 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 py-2 text-sm"
        >
          {items.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      ) : null}

      <button
        type="button"
        aria-label="Add tool"
        onClick={() => openEdit(null)}
        data-testid="inventory-add-fab"
        className="fixed bottom-20 right-4 z-30 rounded-full bg-gold-bright px-5 py-3 font-semibold text-workshop shadow-lg"
      >
        + Add tool
      </button>

      <ItemEditDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        item={editing}
        knownCategories={knownCategories}
      />
      <CsvImportModal open={csvOpen} onClose={() => setCsvOpen(false)} />
    </AdminLayout>
  );
}
