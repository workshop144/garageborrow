type Props = {
  value: string;
  onChange: (next: string) => void;
};

export function StepNotes({ value, onChange }: Props): JSX.Element {
  return (
    <div className="space-y-4" data-testid="donate-step-notes">
      <header>
        <h2 className="font-heading text-2xl">Anything Dad should know?</h2>
        <p className="mt-1 text-sm opacity-80">
          Optional. Quirks, missing parts, or how it was last used.
        </p>
      </header>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        className="w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2 text-sm"
        placeholder="The chuck sticks sometimes — a tap on the bench frees it."
        data-testid="donate-notes-input"
      />
    </div>
  );
}
