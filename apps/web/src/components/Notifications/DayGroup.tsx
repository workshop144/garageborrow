import type { ReactNode } from "react";
import type { Notification } from "@garageborrow/shared";

import { APP_TIMEZONE } from "../../lib/dates";
import { formatInTimeZone } from "date-fns-tz";

export type DayBucket = "today" | "yesterday" | "thisWeek" | "older";

const LABELS: Record<DayBucket, string> = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This Week",
  older: "Older",
};

const MS_DAY = 86_400_000;

export function bucketFor(sentAt: string, now: Date = new Date()): DayBucket {
  const sentZoned = formatInTimeZone(sentAt, APP_TIMEZONE, "yyyy-MM-dd");
  const todayZoned = formatInTimeZone(now, APP_TIMEZONE, "yyyy-MM-dd");
  if (sentZoned === todayZoned) return "today";

  const yesterday = new Date(now.getTime() - MS_DAY);
  const yZoned = formatInTimeZone(yesterday, APP_TIMEZONE, "yyyy-MM-dd");
  if (sentZoned === yZoned) return "yesterday";

  // "This Week" = within last 7 days, but not today/yesterday.
  const weekAgo = new Date(now.getTime() - 7 * MS_DAY);
  if (new Date(sentAt).getTime() >= weekAgo.getTime()) return "thisWeek";
  return "older";
}

export type GroupedNotifications = Array<{ bucket: DayBucket; items: Notification[] }>;

export function groupByDay(items: Notification[], now: Date = new Date()): GroupedNotifications {
  const order: DayBucket[] = ["today", "yesterday", "thisWeek", "older"];
  const map = new Map<DayBucket, Notification[]>();
  for (const it of items) {
    const b = bucketFor(it.sent_at, now);
    const list = map.get(b) ?? [];
    list.push(it);
    map.set(b, list);
  }
  return order.filter((b) => map.has(b)).map((b) => ({ bucket: b, items: map.get(b) ?? [] }));
}

type Props = {
  bucket: DayBucket;
  children: ReactNode;
};

export function DayGroup({ bucket, children }: Props): JSX.Element {
  return (
    <section data-testid={`day-group-${bucket}`} className="space-y-2">
      <h2 className="font-heading text-sm uppercase tracking-wide opacity-60">{LABELS[bucket]}</h2>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}
