type Props = {
  name: string;
  description: string;
  onChange: (next: { name?: string; description?: string }) => void;
};

export function StepName({ name, description, onChange }: Props): JSX.Element {
  return (
    <div className="space-y-4" data-testid="donate-step-name">
      <header>
        <h2 className="font-heading text-2xl">What are you donating?</h2>
        <p className="mt-1 text-sm opacity-80">
          A name and a quick description help Dad picture what you&apos;re offering.
        </p>
      </header>
      <label className="block text-sm">
        <span className="block font-semibold">Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
          placeholder="e.g. Cordless drill"
          data-testid="donate-name-input"
          required
        />
      </label>
      <label className="block text-sm">
        <span className="block font-semibold">Description</span>
        <textarea
          value={description}
          onChange={(e) => onChange({ description: e.target.value })}
          rows={4}
          className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
          placeholder="Brand, model, anything notable about it."
          data-testid="donate-description-input"
        />
      </label>
    </div>
  );
}
