import { useMemo, useState } from "react";
import type { DonationOffer } from "@garageborrow/shared";

import { AdminLayout } from "../../components/Admin/AdminLayout";
import { DonationDecideDrawer } from "../../components/Admin/Donations/DonationDecideDrawer";
import { useAdminDonations } from "../../hooks/useAdminDonations";

const STATUS_PILL: Record<string, string> = {
  pending: "bg-status-out/20 text-status-out",
  accepted: "bg-status-available/20 text-status-available",
  declined: "bg-status-overdue/20 text-status-overdue",
  received: "bg-workshop/10 dark:bg-surface-light/10",
};

export default function Donations(): JSX.Element {
  const donations = useAdminDonations();
  const all = useMemo(
    () => donations.data?.pages.flatMap((p) => p.donations) ?? [],
    [donations.data],
  );
  const pending = all.filter((d) => d.status === "pending");
  const decided = all.filter((d) => d.status !== "pending");
  const [active, setActive] = useState<DonationOffer | null>(null);

  return (
    <AdminLayout>
      <header className="mb-4">
        <h1 className="font-heading text-3xl text-gold-bright">Donations</h1>
      </header>

      {donations.isLoading ? (
        <p className="opacity-70">Loading…</p>
      ) : (
        <>
          <section>
            <h2 className="mb-2 text-sm font-semibold opacity-80">Pending ({pending.length})</h2>
            {pending.length === 0 ? (
              <p className="opacity-70">No pending donations. 🎉</p>
            ) : (
              <ul className="space-y-2">
                {pending.map((d) => (
                  <li
                    key={d.id}
                    className="rounded-2xl border border-workshop/15 dark:border-surface-light/15 p-3"
                  >
                    <div className="flex items-baseline justify-between">
                      <p className="font-semibold">{d.item_name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_PILL[d.status]}`}>
                        {d.status}
                      </span>
                    </div>
                    <p className="text-sm opacity-80">{d.description}</p>
                    {d.donor_notes ? (
                      <p className="mt-1 text-xs italic opacity-70">“{d.donor_notes}”</p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setActive(d)}
                      className="mt-2 rounded-xl bg-gold-bright px-3 py-1 text-sm font-semibold text-workshop"
                    >
                      Decide
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {decided.length > 0 ? (
            <section className="mt-6">
              <h2 className="mb-2 text-sm font-semibold opacity-80">Decided</h2>
              <ul className="space-y-2">
                {decided.map((d) => (
                  <li
                    key={d.id}
                    className="rounded-2xl border border-workshop/10 dark:border-surface-light/10 p-3 text-sm"
                  >
                    <div className="flex items-baseline justify-between">
                      <p>{d.item_name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_PILL[d.status]}`}>
                        {d.status}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      <DonationDecideDrawer
        open={active !== null}
        onClose={() => setActive(null)}
        donation={active}
      />
    </AdminLayout>
  );
}
