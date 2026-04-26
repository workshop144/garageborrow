import { useMemo, useState } from "react";
import type { IncidentStatus } from "@garageborrow/shared";

import { AdminLayout } from "../../components/Admin/AdminLayout";
import { useAdminIncidents, useUpdateIncident } from "../../hooks/useAdminIncidents";
import { formatRelative } from "../../lib/dates";

const STATUSES: (IncidentStatus | "all")[] = ["open", "resolved", "closed", "all"];
const STATUS_PILL: Record<string, string> = {
  open: "bg-status-overdue/20 text-status-overdue",
  resolved: "bg-status-available/20 text-status-available",
  closed: "bg-workshop/10 dark:bg-surface-light/10",
};

export default function Incidents(): JSX.Element {
  const [status, setStatus] = useState<IncidentStatus | "all">("open");
  const [resolutionNotesById, setResolutionNotesById] = useState<Record<string, string>>({});
  const incidents = useAdminIncidents(status);
  const update = useUpdateIncident();
  const all = useMemo(
    () => incidents.data?.pages.flatMap((p) => p.incidents) ?? [],
    [incidents.data],
  );

  return (
    <AdminLayout>
      <header className="mb-4">
        <h1 className="font-heading text-3xl text-gold-bright">Incidents</h1>
      </header>

      <div className="mb-4 flex gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-xl px-3 py-1 text-sm ${
              status === s
                ? "bg-gold-bright font-semibold text-workshop"
                : "border border-workshop/15 dark:border-surface-light/15"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {incidents.isLoading ? (
        <p className="opacity-70">Loading…</p>
      ) : all.length === 0 ? (
        <p className="opacity-70">No incidents in this view.</p>
      ) : (
        <ul className="space-y-3">
          {all.map((i) => (
            <li
              key={i.id}
              className="rounded-2xl border border-workshop/15 dark:border-surface-light/15 p-3"
            >
              <div className="flex items-baseline justify-between">
                <p className="font-semibold capitalize">{i.type}</p>
                <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_PILL[i.status] ?? ""}`}>
                  {i.status}
                </span>
              </div>
              <p className="mt-1 text-sm opacity-80">{i.description}</p>
              <p className="mt-1 text-xs opacity-70">
                Reported {formatRelative(i.created_at)} by {i.reporter_phone.slice(-4)}
              </p>
              {i.status === "open" ? (
                <div className="mt-2 space-y-2">
                  <textarea
                    placeholder="Resolution notes (optional)"
                    value={resolutionNotesById[i.id] ?? ""}
                    onChange={(e) =>
                      setResolutionNotesById((prev) => ({ ...prev, [i.id]: e.target.value }))
                    }
                    rows={2}
                    className="w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        update.mutate({
                          incidentId: i.id,
                          status: "resolved",
                          ...(resolutionNotesById[i.id]
                            ? { resolution_notes: resolutionNotesById[i.id] ?? "" }
                            : {}),
                        })
                      }
                      className="rounded-xl bg-gold-bright px-3 py-1 text-sm font-semibold text-workshop"
                    >
                      Mark resolved
                    </button>
                    <button
                      type="button"
                      onClick={() => update.mutate({ incidentId: i.id, status: "closed" })}
                      className="rounded-xl border border-workshop/15 dark:border-surface-light/15 px-3 py-1 text-sm"
                    >
                      Close
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </AdminLayout>
  );
}
