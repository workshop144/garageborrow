import { useMemo } from "react";

import { AdminLayout } from "../../components/Admin/AdminLayout";
import { ActiveLoanRow } from "../../components/Admin/OutRightNow/ActiveLoanRow";
import { useActiveLoans } from "../../hooks/useActiveLoans";
import { useAdminItems } from "../../hooks/useAdminItems";

export default function OutRightNow(): JSX.Element {
  const loans = useActiveLoans();
  // Pull names from the inventory list so each row knows its item name without
  // a per-row request. Inventory list is already cached by the items page.
  const items = useAdminItems({ sort: "alphabetical" });
  const itemNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const page of items.data?.pages ?? []) {
      for (const it of page.items) map.set(it.id, it.name);
    }
    return map;
  }, [items.data]);

  return (
    <AdminLayout>
      <header className="mb-4">
        <h1 className="font-heading text-3xl text-gold-bright">Out right now</h1>
        <p className="mt-1 text-sm opacity-70">
          Tools currently out, who has them, and when they&apos;re due back.
        </p>
      </header>

      {loans.isLoading ? (
        <p className="opacity-70">Loading…</p>
      ) : loans.isError ? (
        <p className="text-status-overdue">Couldn&apos;t load loans.</p>
      ) : loans.data && loans.data.loans.length === 0 ? (
        <div className="rounded-2xl border border-workshop/15 dark:border-surface-light/15 p-6 text-center">
          <p className="font-heading text-xl">Pegboard&apos;s full.</p>
          <p className="mt-2 text-sm opacity-70">Nothing out at the moment.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {loans.data?.loans.map((loan) => (
            <ActiveLoanRow key={loan.id} loan={loan} itemName={itemNameById.get(loan.item_id)} />
          ))}
        </div>
      )}
    </AdminLayout>
  );
}
