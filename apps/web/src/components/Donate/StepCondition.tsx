import type { DonationCondition } from "@garageborrow/shared";

type Props = {
  value: DonationCondition | null;
  onChange: (next: DonationCondition) => void;
};

const OPTIONS: Array<{ value: DonationCondition; title: string; example: string }> = [
  { value: "new", title: "New", example: "Still in the box, never used." },
  { value: "good", title: "Good", example: "Used a few times, works great." },
  { value: "fair", title: "Fair", example: "Some scuffs, but solid." },
  { value: "poor", title: "Poor", example: "Tired but functional, or needs minor repair." },
];

export function StepCondition({ value, onChange }: Props): JSX.Element {
  return (
    <div className="space-y-4" data-testid="donate-step-condition">
      <header>
        <h2 className="font-heading text-2xl">What kind of shape is it in?</h2>
        <p className="mt-1 text-sm opacity-80">Honest is fine — we&apos;d rather know.</p>
      </header>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {OPTIONS.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-colors ${
                selected
                  ? "border-gold-bright bg-gold-bright/10"
                  : "border-workshop/15 dark:border-surface-light/15 hover:border-gold-bright/60"
              }`}
              data-testid={`donate-condition-${opt.value}`}
              aria-pressed={selected}
            >
              <span className="font-heading text-lg">{opt.title}</span>
              <span className="text-xs opacity-80">{opt.example}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
