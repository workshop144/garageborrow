import type { LiabilityTier } from "../../lib/borrow-copy";

type Props = {
  tier: LiabilityTier;
  copy: string;
};

const TIER_LABEL: Record<LiabilityTier, string> = {
  standard: "Heads up",
  "power-tool": "Heads up — this one bites",
  "high-value": "Before you sign on",
};

export function LiabilityCallout({ tier, copy }: Props): JSX.Element {
  return (
    <div
      role="region"
      aria-label="Liability acknowledgement"
      data-testid="liability-callout"
      data-tier={tier}
      className="rounded-xl border-2 border-gold-accent/60 bg-gold-accent/10 p-4 text-sm italic text-workshop/90 dark:text-surface-light/90"
    >
      <p className="not-italic font-semibold text-gold-accent mb-1">{TIER_LABEL[tier]}</p>
      {copy.split("\n\n").map((para, i) => (
        <p key={i} className={i > 0 ? "mt-2" : ""}>
          {para}
        </p>
      ))}
    </div>
  );
}
