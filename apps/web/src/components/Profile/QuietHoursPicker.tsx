type Props = {
  start: string;
  end: string;
  onChange: (next: { start: string; end: string }) => void;
};

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidHhMm(value: string): boolean {
  return HHMM_RE.test(value);
}

export function QuietHoursPicker({ start, end, onChange }: Props): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3" data-testid="quiet-hours-picker">
      <label className="block text-sm">
        <span className="opacity-70">Quiet from</span>
        <input
          type="time"
          value={start}
          onChange={(e) => onChange({ start: e.target.value, end })}
          className="mt-1 block w-full rounded-xl border border-workshop/20 dark:border-surface-light/20 bg-transparent px-3 py-2"
          data-testid="quiet-start"
          aria-invalid={!isValidHhMm(start)}
        />
      </label>
      <label className="block text-sm">
        <span className="opacity-70">until</span>
        <input
          type="time"
          value={end}
          onChange={(e) => onChange({ start, end: e.target.value })}
          className="mt-1 block w-full rounded-xl border border-workshop/20 dark:border-surface-light/20 bg-transparent px-3 py-2"
          data-testid="quiet-end"
          aria-invalid={!isValidHhMm(end)}
        />
      </label>
    </div>
  );
}
