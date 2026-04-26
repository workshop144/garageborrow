import { Link } from "react-router-dom";
import type { DonationOffer } from "@garageborrow/shared";

import { useMyDonations } from "../../hooks/useMyDonations";
import { formatRelative } from "../../lib/dates";
import { DonationStatusPill } from "./DonationStatusPill";

function statusCopy(d: DonationOffer): { headline: string; detail?: string; itemId?: string } {
  switch (d.status) {
    case "pending":
      return { headline: "Dad's looking at it" };
    case "accepted":
    case "received":
      return {
        headline: "It's in the garage now — see it on the pegboard",
        ...(d.resulting_item_id ? { itemId: d.resulting_item_id } : {}),
      };
    case "declined":
      return {
        headline: "Dad passed on this one.",
        ...(d.decline_reason ? { detail: `Reason: ${d.decline_reason}` } : {}),
      };
  }
}

export function MyDonationsList(): JSX.Element {
  const q = useMyDonations();
  const donations = q.data?.pages.flatMap((p) => p.donations) ?? [];

  if (q.isLoading) {
    return (
      <p className="rounded-xl border border-workshop/10 dark:border-surface-light/10 p-6 text-center text-sm opacity-70">
        Loading your donations…
      </p>
    );
  }
  if (q.isError) {
    return (
      <p
        className="rounded-xl border border-status-overdue/40 bg-status-overdue/10 p-4 text-sm"
        data-testid="my-donations-error"
      >
        Couldn&apos;t load your donations just now.
      </p>
    );
  }
  if (donations.length === 0) {
    return (
      <div
        className="rounded-xl border border-workshop/15 dark:border-surface-light/10 p-6 text-center"
        data-testid="my-donations-empty"
      >
        <p className="font-heading text-xl">Nothing donated yet.</p>
        <p className="mt-2 text-sm opacity-70">
          Got something gathering dust?{" "}
          <Link to="/donate" className="font-semibold underline">
            Offer it to the garage
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="my-donations-list">
      <ul className="space-y-3">
        {donations.map((d) => {
          const copy = statusCopy(d);
          return (
            <li
              key={d.id}
              className="rounded-xl border border-workshop/15 dark:border-surface-light/10 bg-surface-light/60 dark:bg-workshop/40 p-3"
              data-testid={`my-donation-${d.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-heading text-lg leading-tight">{d.item_name}</p>
                  <p className="mt-0.5 text-xs opacity-70">{formatRelative(d.created_at)}</p>
                </div>
                <DonationStatusPill status={d.status} />
              </div>
              <p className="mt-2 text-sm">{copy.headline}</p>
              {copy.detail ? <p className="mt-1 text-xs opacity-80">{copy.detail}</p> : null}
              {copy.itemId ? (
                <Link
                  to={`/tool/${copy.itemId}`}
                  className="mt-2 inline-block text-sm font-semibold underline"
                  data-testid={`my-donation-link-${d.id}`}
                >
                  See it on the pegboard
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
      {q.hasNextPage ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void q.fetchNextPage()}
            disabled={q.isFetchingNextPage}
            className="rounded-xl border border-workshop/15 dark:border-surface-light/15 px-3 py-2 text-sm"
            data-testid="my-donations-load-more"
          >
            {q.isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
