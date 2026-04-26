import type { MyStuffResponse } from "../../hooks/useMyStuff";

type Props = {
  stats: MyStuffResponse["stats"];
};

export function computeStatLabels(stats: MyStuffResponse["stats"]): string[] {
  const out: string[] = [];
  out.push(`${stats.borrows_total} borrowed`);
  out.push(`${stats.returns_on_time} on time`);
  out.push(`${stats.borrows_active} out now`);
  return out;
}

export function StatsChips({ stats }: Props): JSX.Element {
  const labels = computeStatLabels(stats);
  return (
    <div className="flex flex-wrap gap-2" data-testid="stats-chips">
      {labels.map((label) => (
        <span
          key={label}
          className="rounded-full border border-workshop/15 dark:border-surface-light/15 bg-workshop/5 dark:bg-surface-light/5 px-3 py-1 text-xs"
        >
          {label}
        </span>
      ))}
    </div>
  );
}
