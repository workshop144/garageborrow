import type { Instance } from "@garageborrow/shared";

type Props = {
  instances: Instance[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

const TIER_BADGE_CLASS: Record<string, string> = {
  premium: "bg-gold-bright/25 text-gold-bright border-gold-bright/50",
  good: "bg-status-available/15 text-status-available border-status-available/40",
  rough: "bg-workshop/15 text-workshop/80 border-workshop/30",
};

const STATUS_LABEL: Record<Instance["status"], string> = {
  available: "Available",
  loaned: "Loaned out",
  reserved: "Reserved",
  maintenance: "In maintenance",
  broken: "Broken",
  retired: "Retired",
};

function tierClass(tier: string): string {
  return (
    TIER_BADGE_CLASS[tier.toLowerCase()] ??
    "bg-workshop/10 text-workshop/80 border-workshop/20 dark:bg-surface-light/10 dark:text-surface-light/80 dark:border-surface-light/20"
  );
}

export function InstanceList({ instances, selectedId, onSelect }: Props): JSX.Element | null {
  if (instances.length <= 1) return null;
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {instances.map((inst) => {
        const disabled = inst.status !== "available";
        const isSelected = selectedId === inst.id;
        return (
          <li key={inst.id}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(inst.id)}
              aria-pressed={isSelected}
              className={`w-full text-left flex items-center gap-3 rounded-xl border p-3 transition-colors ${
                isSelected
                  ? "border-gold-bright bg-gold-bright/10"
                  : "border-workshop/15 dark:border-surface-light/15 bg-surface-light dark:bg-workshop/40"
              } ${disabled ? "opacity-60 cursor-not-allowed" : "hover:border-gold-bright/60"}`}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-workshop/10 dark:bg-surface-light/10 font-heading text-lg text-gold-primary">
                {inst.label.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold leading-tight truncate">{inst.label}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
                  <span
                    className={`inline-flex items-center rounded-full border px-1.5 py-0.5 uppercase tracking-wide font-semibold ${tierClass(
                      inst.quality_tier,
                    )}`}
                  >
                    {inst.quality_tier}
                  </span>
                  <span className="opacity-70">{STATUS_LABEL[inst.status]}</span>
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
