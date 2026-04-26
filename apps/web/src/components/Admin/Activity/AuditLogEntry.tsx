import { useState } from "react";
import type { AuditLogEntry as AuditLogEntryRecord } from "@garageborrow/shared";

import { formatInAppZone } from "../../../lib/dates";

type Props = { entry: AuditLogEntryRecord };

export function AuditLogEntry({ entry }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <li
      className="rounded-2xl border border-workshop/10 dark:border-surface-light/10 p-3 text-sm"
      data-testid={`audit-entry-${entry.id}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-semibold">{entry.action_type}</p>
          <p className="text-xs opacity-70">
            {entry.entity_type} · {entry.entity_id}
          </p>
        </div>
        <div className="text-right text-xs opacity-70">
          <p>{entry.actor_phone.slice(-4)}</p>
          <p>{formatInAppZone(entry.created_at, "MMM d, yyyy h:mm a")}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-2 text-xs underline opacity-80"
      >
        {open ? "Hide diff" : "Show diff"}
      </button>
      {open ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2" data-testid="audit-diff">
          <div>
            <p className="mb-1 text-xs font-semibold opacity-70">Before</p>
            <pre className="overflow-auto rounded-lg bg-workshop/5 dark:bg-surface-light/5 p-2 text-[11px]">
              {JSON.stringify(entry.before_snapshot, null, 2)}
            </pre>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold opacity-70">After</p>
            <pre className="overflow-auto rounded-lg bg-workshop/5 dark:bg-surface-light/5 p-2 text-[11px]">
              {JSON.stringify(entry.after_snapshot, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </li>
  );
}
