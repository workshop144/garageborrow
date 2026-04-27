import { Link, useParams } from "react-router-dom";

import { AppShell } from "../components/AppShell";
import { useWishlistRequest } from "../hooks/useWishlistRequest";
import { useWishlistVote } from "../hooks/useWishlistVote";
import { formatRelative } from "../lib/dates";

export default function WishlistDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const detail = useWishlistRequest(id ?? "");
  const vote = useWishlistVote();

  if (!id) {
    return (
      <AppShell>
        <p className="text-sm">Bad link.</p>
      </AppShell>
    );
  }

  if (detail.isLoading) {
    return (
      <AppShell>
        <p className="text-sm opacity-70">Loading…</p>
      </AppShell>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <AppShell>
        <p className="text-sm">Couldn&apos;t load this request.</p>
      </AppShell>
    );
  }

  const r = detail.data.request;
  const voters = detail.data.voters;
  const requesterName =
    detail.data.requester_display_name ?? `Member ${r.requester_phone.slice(-4)}`;

  const isOpen = r.status === "open";

  return (
    <AppShell>
      <div className="mb-2">
        <Link to="/wishlist" className="text-sm opacity-70 underline">
          ← Wishlist
        </Link>
      </div>

      <header className="mb-4">
        <h1 className="font-heading text-3xl break-words">{r.item_name}</h1>
        <p className="mt-1 text-xs opacity-70">
          From {requesterName} · {formatRelative(r.created_at)}
          {r.desired_by ? ` · needed by ${r.desired_by}` : ""}
        </p>
      </header>

      {!isOpen ? <StatusBanner request={r} /> : null}

      {r.description ? (
        <p
          className="mb-4 whitespace-pre-line rounded-xl border border-workshop/10 dark:border-surface-light/10 bg-surface-light/60 dark:bg-workshop/40 p-3 text-sm"
          data-testid="wishlist-description"
        >
          {r.description}
        </p>
      ) : null}

      {r.reason ? (
        <p className="mb-4 text-sm">
          <span className="font-semibold">Why: </span>
          {r.reason}
        </p>
      ) : null}

      {r.reference_url ? (
        <p className="mb-4 break-all text-sm">
          <span className="font-semibold">Reference: </span>
          <a href={r.reference_url} target="_blank" rel="noopener noreferrer" className="underline">
            {r.reference_url}
          </a>
        </p>
      ) : null}

      {r.photo_url ? (
        <img
          src={`/img/${r.photo_url}`}
          alt=""
          className="mb-4 max-h-72 w-full rounded-xl object-cover"
        />
      ) : null}

      <div className="mb-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => vote.mutate({ id: r.id, voted: r.my_vote })}
          disabled={vote.isPending || !isOpen}
          aria-pressed={r.my_vote}
          data-testid="wishlist-detail-vote"
          className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold ${
            r.my_vote
              ? "border-gold-bright bg-gold-bright text-workshop"
              : "border-workshop/15 dark:border-surface-light/15"
          } disabled:opacity-50`}
        >
          <span aria-hidden>{r.my_vote ? "♥" : "♡"}</span>
          <span>{r.my_vote ? "Voted" : "Vote"}</span>
        </button>
        <span className="text-sm opacity-70">
          {r.vote_count} {r.vote_count === 1 ? "person wants this" : "people want this"}
        </span>
      </div>

      <section aria-labelledby="voters-heading">
        <h2 id="voters-heading" className="mb-2 font-heading text-lg">
          Voters
        </h2>
        <ul className="space-y-1 text-sm">
          {voters.map((v) => (
            <li key={v.phone} className="opacity-80">
              {v.display_name ?? `Member ${v.phone.slice(-4)}`}
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}

function StatusBanner({
  request,
}: {
  request: import("../hooks/useWishlist").WishlistRow;
}): JSX.Element {
  if (request.status === "acquired") {
    return (
      <div
        data-testid="wishlist-status-acquired"
        className="mb-4 rounded-xl border border-gold-bright/40 bg-gold-bright/10 p-3 text-sm"
      >
        It&apos;s in the garage!{" "}
        {request.acquired_item_id ? (
          <Link to={`/tool/${request.acquired_item_id}`} className="font-semibold underline">
            See it on the pegboard
          </Link>
        ) : null}
      </div>
    );
  }
  if (request.status === "declined") {
    return (
      <div
        data-testid="wishlist-status-declined"
        className="mb-4 rounded-xl border border-status-overdue/40 bg-status-overdue/10 p-3 text-sm"
      >
        Dad passed on this one
        {request.decline_reason ? `: ${request.decline_reason}` : "."}
      </div>
    );
  }
  if (request.status === "duplicate") {
    return (
      <div
        data-testid="wishlist-status-duplicate"
        className="mb-4 rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-workshop/10 p-3 text-sm"
      >
        Tracked under{" "}
        {request.duplicate_of_id ? (
          <Link to={`/wishlist/${request.duplicate_of_id}`} className="font-semibold underline">
            an existing request
          </Link>
        ) : (
          "an existing request"
        )}
        .
      </div>
    );
  }
  return (
    <div
      data-testid="wishlist-status-cancelled"
      className="mb-4 rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-workshop/5 p-3 text-sm"
    >
      Requester pulled this one.
    </div>
  );
}
