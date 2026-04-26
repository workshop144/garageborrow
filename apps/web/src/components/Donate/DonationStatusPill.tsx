import type { DonationOfferStatus } from "@garageborrow/shared";

type Props = {
  status: DonationOfferStatus;
};

const META: Record<DonationOfferStatus, { label: string; tone: string }> = {
  pending: { label: "Pending", tone: "bg-tier-howdy/30 text-workshop dark:text-surface-light" },
  accepted: {
    label: "Accepted",
    tone: "bg-status-on-time/20 text-status-on-time",
  },
  declined: {
    label: "Declined",
    tone: "bg-workshop/15 dark:bg-surface-light/15 opacity-80",
  },
  received: {
    label: "Received",
    tone: "bg-status-on-time/20 text-status-on-time",
  },
};

export function DonationStatusPill({ status }: Props): JSX.Element {
  const m = META[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${m.tone}`}
      data-testid={`donation-status-${status}`}
    >
      {m.label}
    </span>
  );
}
