import { Link } from "react-router-dom";
import type { Notification } from "@garageborrow/shared";

import { formatRelative } from "../../lib/dates";

type Props = {
  notification: Notification;
  onMarkRead: (id: string) => void;
};

const ICONS: Record<string, string> = {
  loan_extended: "⏳",
  loan_returned: "✅",
  loan_due: "🔔",
  reservation_approved: "👍",
  reservation_declined: "🤚",
  waitlist_promoted: "🎉",
  promotion_celebration: "🎊",
  new_tool: "🔧",
};

function iconFor(type: string): string {
  return ICONS[type] ?? "📬";
}

function titleFor(type: string, payload: Record<string, unknown>): string {
  if (typeof payload["title"] === "string") return payload["title"];
  switch (type) {
    case "loan_extended":
      return "Extension confirmed";
    case "loan_returned":
      return "Return logged";
    case "loan_due":
      return "Heads up — return coming up";
    case "reservation_approved":
      return "Approved";
    case "reservation_declined":
      return "Not this time";
    case "waitlist_promoted":
      return "It&apos;s your turn";
    case "promotion_celebration":
      return "You got promoted";
    case "new_tool":
      return "New on the pegboard";
    default:
      return "Update";
  }
}

function bodyFor(payload: Record<string, unknown>): string | undefined {
  if (typeof payload["body"] === "string") return payload["body"];
  if (typeof payload["message"] === "string") return payload["message"];
  return undefined;
}

export function NotificationListItem({ notification, onMarkRead }: Props): JSX.Element {
  const unread = !notification.read_at;
  const deeplink =
    typeof notification.payload["deeplink"] === "string"
      ? (notification.payload["deeplink"] as string)
      : undefined;

  function handleActivate(): void {
    if (unread) onMarkRead(notification.id);
  }

  const className = `flex items-start gap-3 rounded-xl border bg-surface-light/60 dark:bg-workshop/40 p-3 transition-colors ${
    unread
      ? "border-l-4 border-l-gold-bright border-y-workshop/10 border-r-workshop/10 dark:border-y-surface-light/10 dark:border-r-surface-light/10"
      : "border-workshop/10 dark:border-surface-light/10"
  }`;

  const inner = (
    <>
      <span aria-hidden="true" className="text-2xl leading-none">
        {iconFor(notification.type)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold leading-snug">
          {titleFor(notification.type, notification.payload)}
        </p>
        {bodyFor(notification.payload) ? (
          <p className="text-sm opacity-80">{bodyFor(notification.payload)}</p>
        ) : null}
        <p className="mt-1 text-xs opacity-60">{formatRelative(notification.sent_at)}</p>
      </div>
    </>
  );

  if (deeplink) {
    return (
      <Link
        to={deeplink}
        onClick={handleActivate}
        data-testid="notification-item"
        data-unread={unread || undefined}
        className={className}
      >
        {inner}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={handleActivate}
      data-testid="notification-item"
      data-unread={unread || undefined}
      className={`${className} text-left`}
    >
      {inner}
    </button>
  );
}
