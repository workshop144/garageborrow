import { useMemo, useState } from "react";
import type { GarageMembership } from "@garageborrow/shared";

import { AdminLayout } from "../../components/Admin/AdminLayout";
import { MemberEditDrawer } from "../../components/Admin/Members/MemberEditDrawer";
import { PromotionSuggestionsBanner } from "../../components/Admin/Members/PromotionSuggestionsBanner";
import { useAdminMembers } from "../../hooks/useAdminMembers";

function onTimeRate(m: GarageMembership): string {
  const total = m.returns_on_time + m.returns_late;
  if (total === 0) return "—";
  return `${Math.round((m.returns_on_time / total) * 100)}%`;
}

export default function MembersAdmin(): JSX.Element {
  const [editing, setEditing] = useState<GarageMembership | null>(null);
  const [open, setOpen] = useState(false);
  const members = useAdminMembers();
  const all = useMemo(() => members.data?.pages.flatMap((p) => p.members) ?? [], [members.data]);

  return (
    <AdminLayout>
      <header className="mb-4">
        <h1 className="font-heading text-3xl text-gold-bright">Members</h1>
      </header>

      <PromotionSuggestionsBanner />

      {members.isLoading ? (
        <p className="opacity-70">Loading…</p>
      ) : all.length === 0 ? (
        <p className="opacity-70">No members yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-workshop/15 dark:border-surface-light/15">
          <table className="min-w-full text-sm">
            <thead className="bg-workshop/5 dark:bg-surface-light/5 text-left">
              <tr>
                <th className="px-3 py-2 font-semibold">Phone</th>
                <th className="px-3 py-2 font-semibold">Tier</th>
                <th className="px-3 py-2 font-semibold">Borrows</th>
                <th className="px-3 py-2 font-semibold">On-time</th>
                <th className="px-3 py-2 font-semibold">Joined</th>
              </tr>
            </thead>
            <tbody>
              {all.map((m) => (
                <tr
                  key={m.user_phone}
                  className="border-t border-workshop/10 dark:border-surface-light/10 hover:bg-workshop/5 dark:hover:bg-surface-light/5"
                >
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="underline"
                      onClick={() => {
                        setEditing(m);
                        setOpen(true);
                      }}
                    >
                      {m.user_phone}
                    </button>
                  </td>
                  <td className="px-3 py-2">{m.tier}</td>
                  <td className="px-3 py-2">{m.borrows_total}</td>
                  <td className="px-3 py-2">{onTimeRate(m)}</td>
                  <td className="px-3 py-2 opacity-70">{m.joined_at.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {members.hasNextPage ? (
        <button
          type="button"
          onClick={() => void members.fetchNextPage()}
          disabled={members.isFetchingNextPage}
          className="mt-4 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 py-2 text-sm"
        >
          {members.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      ) : null}

      <MemberEditDrawer open={open} onClose={() => setOpen(false)} member={editing} />
    </AdminLayout>
  );
}
