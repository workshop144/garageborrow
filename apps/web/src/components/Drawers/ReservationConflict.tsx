import type { Instance } from "@garageborrow/shared";

import { formatRelative } from "../../lib/dates";

export type InstanceUnavailableDetails = {
  suggested_alternates?: string[];
  next_available_date?: string;
};

type Props = {
  details: InstanceUnavailableDetails;
  instances: Instance[];
  onPickAlternate: (instanceId: string) => void;
  onTryNextDate: (isoDate: string) => void;
  onDismiss: () => void;
};

export function ReservationConflict({
  details,
  instances,
  onPickAlternate,
  onTryNextDate,
  onDismiss,
}: Props): JSX.Element {
  const alternates = (details.suggested_alternates ?? [])
    .map((id) => instances.find((i) => i.id === id))
    .filter((x): x is Instance => Boolean(x));
  const nextDate = details.next_available_date;

  return (
    <div
      role="alertdialog"
      aria-label="Just snagged"
      data-testid="reservation-conflict"
      className="rounded-2xl border border-status-overdue/40 bg-status-overdue/10 p-5"
    >
      <p className="font-heading text-xl text-workshop dark:text-surface-light">
        Just snagged by someone else.
      </p>
      <p className="mt-1 text-sm opacity-80">
        {alternates.length > 0
          ? "Pick a different one or try the next available date."
          : nextDate
            ? "Try the next available date below."
            : "Try again in a bit, or join the waitlist."}
      </p>

      {alternates.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {alternates.map((inst) => (
            <li key={inst.id}>
              <button
                type="button"
                onClick={() => onPickAlternate(inst.id)}
                className="w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-surface-light dark:bg-workshop/40 px-4 py-3 text-left hover:border-gold-bright/60"
              >
                <span className="font-semibold">{inst.label}</span>
                <span className="ml-2 text-xs uppercase opacity-70">{inst.quality_tier}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {nextDate ? (
        <button
          type="button"
          onClick={() => onTryNextDate(nextDate)}
          className="mt-4 w-full rounded-xl bg-gold-accent px-4 py-3 font-semibold text-workshop"
        >
          Try {formatRelative(nextDate)}
        </button>
      ) : null}

      <button
        type="button"
        onClick={onDismiss}
        className="mt-3 w-full rounded-xl border border-workshop/20 dark:border-surface-light/20 px-4 py-3 text-sm opacity-80 hover:opacity-100"
      >
        Dismiss
      </button>
    </div>
  );
}
