import { Link } from "react-router-dom";

import { formatDateInput } from "../../lib/dates";
import { useCancelReservation } from "../../hooks/useMyStuff";
import type { MyReservation } from "../../hooks/useMyStuff";

type Props = {
  reservation: MyReservation;
};

const STATUS_COPY: Record<string, string> = {
  pending: "Waiting on Dad's nod",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Cancelled",
};

export function ReservationCard({ reservation }: Props): JSX.Element {
  const cancel = useCancelReservation();
  const status = reservation.reservation.status;

  return (
    <article
      data-testid="reservation-card"
      className="rounded-2xl border border-workshop/10 dark:border-surface-light/10 bg-surface-light/60 dark:bg-workshop/40 p-4"
    >
      <div className="flex gap-3">
        <div
          aria-hidden="true"
          className="h-14 w-14 flex-none overflow-hidden rounded-xl bg-workshop/10 dark:bg-surface-light/10"
        >
          {reservation.item.primary_photo_key ? (
            <img
              src={reservation.item.primary_photo_key}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <Link
            to={`/tool/${encodeURIComponent(reservation.item.id)}`}
            className="font-heading text-base leading-snug hover:underline"
          >
            {reservation.item.name}
          </Link>
          <p className="text-xs opacity-70">
            {formatDateInput(reservation.reservation.start_at)} →{" "}
            {formatDateInput(reservation.reservation.end_at)}
          </p>
          <span className="mt-2 inline-block rounded-full border border-workshop/15 dark:border-surface-light/15 px-2 py-0.5 text-[11px] uppercase tracking-wide opacity-80">
            {STATUS_COPY[status] ?? status}
          </span>
        </div>
      </div>
      {status !== "cancelled" && status !== "declined" ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => cancel.mutate({ reservationId: reservation.reservation.id })}
            disabled={cancel.isPending}
            className="rounded-xl border border-workshop/20 dark:border-surface-light/20 px-3 py-1.5 text-sm hover:bg-workshop/5 dark:hover:bg-surface-light/5 disabled:opacity-60"
          >
            {cancel.isPending ? "Cancelling…" : "Cancel"}
          </button>
        </div>
      ) : null}
    </article>
  );
}
