import type { GarageItem } from "../../hooks/useGarageItems";

export type PillVariant = "available" | "out" | "partial" | "request" | "family-only" | "neutral";

type Props = {
  item: GarageItem;
};

type Resolved = { label: string; variant: PillVariant };

function resolve(item: GarageItem): Resolved {
  if (item.status === "broken") return { label: "Broken", variant: "neutral" };
  if (item.status === "maintenance") return { label: "In maintenance", variant: "neutral" };
  if (item.status === "retired" || item.status === "lost") {
    return { label: "Unavailable", variant: "neutral" };
  }
  if (item.status === "all_loaned") {
    return { label: "All out — back soon", variant: "out" };
  }
  if (item.status === "partial_loaned") {
    return { label: "Some available", variant: "partial" };
  }
  if (item.access === "request" && item.requires_approval) {
    return { label: "Ask Dad", variant: "request" };
  }
  if (item.min_tier === "family" && item.access === "instant") {
    // Owner viewing their own family-only item.
    return { label: "Family only — text Dad", variant: "family-only" };
  }
  return { label: "Available", variant: "available" };
}

const VARIANT_CLASSES: Record<PillVariant, string> = {
  available: "bg-status-available/15 text-status-available border-status-available/40",
  out: "bg-status-out/15 text-status-out border-status-out/40",
  partial: "bg-gold-accent/20 text-gold-accent border-gold-accent/40",
  request: "bg-gold-accent/15 text-gold-accent border-gold-accent/40",
  "family-only": "bg-tier-howdy/30 text-workshop border-tier-howdy/60",
  neutral:
    "bg-workshop/10 text-workshop/80 border-workshop/20 dark:bg-surface-light/10 dark:text-surface-light/80 dark:border-surface-light/20",
};

export function StatusPill({ item }: Props): JSX.Element {
  const { label, variant } = resolve(item);
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${VARIANT_CLASSES[variant]}`}
    >
      {label}
    </span>
  );
}
