import { useMemo } from "react";

import { AppShell } from "../components/AppShell";
import { DayGroup, groupByDay } from "../components/Notifications/DayGroup";
import { NotificationListItem } from "../components/Notifications/NotificationListItem";
import { useMarkAllRead, useMarkRead, useNotifications } from "../hooks/useNotifications";

export default function NotificationsInbox(): JSX.Element {
  const query = useNotifications();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  const grouped = useMemo(() => groupByDay(items), [items]);
  const hasUnread = items.some((n) => !n.read_at);

  return (
    <AppShell>
      <header className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="font-heading text-3xl text-gold-bright">Inbox</h1>
          <p className="text-sm opacity-70">Last 30 days.</p>
        </div>
        {hasUnread ? (
          <button
            type="button"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
            data-testid="mark-all-read"
            className="rounded-xl border border-workshop/20 dark:border-surface-light/20 px-3 py-1.5 text-sm hover:bg-workshop/5 dark:hover:bg-surface-light/5 disabled:opacity-60"
          >
            {markAll.isPending ? "Marking…" : "Mark all read"}
          </button>
        ) : null}
      </header>

      {query.isLoading ? (
        <p className="text-sm opacity-70">Loading…</p>
      ) : query.isError ? (
        <p className="text-sm text-status-overdue">Couldn&apos;t load your inbox.</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-workshop/15 dark:border-surface-light/15 bg-surface-light/60 dark:bg-workshop/40 p-8 text-center">
          <p className="font-heading text-xl">Quiet on the wire.</p>
          <p className="mt-2 text-sm opacity-70">We&apos;ll let you know when something happens.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((g) => (
            <DayGroup key={g.bucket} bucket={g.bucket}>
              {g.items.map((n) => (
                <li key={n.id}>
                  <NotificationListItem
                    notification={n}
                    onMarkRead={(id) => markRead.mutate({ id })}
                  />
                </li>
              ))}
            </DayGroup>
          ))}
        </div>
      )}

      {query.hasNextPage ? (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            data-testid="notifications-load-more"
            className="rounded-xl border border-workshop/20 dark:border-surface-light/20 px-4 py-2 text-sm hover:bg-workshop/5 dark:hover:bg-surface-light/5 disabled:opacity-60"
          >
            {query.isFetchingNextPage ? "Loading…" : "Load older"}
          </button>
        </div>
      ) : null}
    </AppShell>
  );
}
