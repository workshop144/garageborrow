import { Link } from "react-router-dom";

import { useLeaveWaitlistFromMyStuff } from "../../hooks/useMyStuff";
import type { MyWaitlistEntry } from "../../hooks/useMyStuff";

type Props = {
  entry: MyWaitlistEntry;
};

export function WaitlistItem({ entry }: Props): JSX.Element {
  const leave = useLeaveWaitlistFromMyStuff();
  return (
    <article
      data-testid="waitlist-item"
      className="rounded-2xl border border-workshop/10 dark:border-surface-light/10 bg-surface-light/60 dark:bg-workshop/40 p-4"
    >
      <div className="flex items-center gap-3">
        <div
          aria-hidden="true"
          className="h-12 w-12 flex-none overflow-hidden rounded-xl bg-workshop/10 dark:bg-surface-light/10"
        >
          {entry.item.primary_photo_key ? (
            <img
              src={entry.item.primary_photo_key}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <Link
            to={`/tool/${encodeURIComponent(entry.item.id)}`}
            className="font-heading text-base leading-snug hover:underline"
          >
            {entry.item.name}
          </Link>
          <p className="text-xs opacity-70">You&apos;re #{entry.entry.position} in line</p>
        </div>
        <button
          type="button"
          onClick={() => leave.mutate({ entryId: entry.entry.id })}
          disabled={leave.isPending}
          className="rounded-xl border border-workshop/20 dark:border-surface-light/20 px-3 py-1.5 text-sm hover:bg-workshop/5 dark:hover:bg-surface-light/5 disabled:opacity-60"
        >
          {leave.isPending ? "Leaving…" : "Leave waitlist"}
        </button>
      </div>
    </article>
  );
}
