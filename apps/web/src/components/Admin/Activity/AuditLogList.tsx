import { useMemo, useState } from "react";

import { AuditLogEntry } from "./AuditLogEntry";
import type { AuditLogFilters } from "../../../hooks/useAuditLog";
import { useAuditLog } from "../../../hooks/useAuditLog";

export function AuditLogList(): JSX.Element {
  const [filters, setFilters] = useState<AuditLogFilters>({});
  const log = useAuditLog(filters);
  const all = useMemo(() => log.data?.pages.flatMap((p) => p.entries) ?? [], [log.data]);

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input
          placeholder="Action type"
          value={filters.action_type ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, action_type: e.target.value || undefined }))}
          className="rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent px-2 py-1 text-sm"
          data-testid="audit-filter-action"
        />
        <input
          placeholder="Actor phone"
          value={filters.actor_phone ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, actor_phone: e.target.value || undefined }))}
          className="rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent px-2 py-1 text-sm"
        />
        <input
          type="date"
          value={filters.since ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, since: e.target.value || undefined }))}
          className="rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent px-2 py-1 text-sm"
        />
        <input
          type="date"
          value={filters.until ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, until: e.target.value || undefined }))}
          className="rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent px-2 py-1 text-sm"
        />
      </div>

      {log.isLoading ? (
        <p className="opacity-70">Loading…</p>
      ) : all.length === 0 ? (
        <p className="opacity-70">No entries match these filters.</p>
      ) : (
        <ul className="space-y-2">
          {all.map((e) => (
            <AuditLogEntry key={e.id} entry={e} />
          ))}
        </ul>
      )}

      {log.hasNextPage ? (
        <button
          type="button"
          onClick={() => void log.fetchNextPage()}
          disabled={log.isFetchingNextPage}
          className="mt-4 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 py-2 text-sm"
        >
          {log.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </div>
  );
}
