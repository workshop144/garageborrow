type Props = {
  displayName: string;
};

function firstInitialName(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return "Friend";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[parts.length - 1]![0]!}.`;
}

export function VisibilityPreview({ displayName }: Props): JSX.Element {
  const visibleName = firstInitialName(displayName);
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="visibility-preview">
      <div
        data-testid="visibility-preview-visible"
        className="rounded-2xl border border-workshop/15 dark:border-surface-light/15 bg-surface-light/60 dark:bg-workshop/40 p-4"
      >
        <p className="text-[11px] uppercase tracking-wide opacity-60">Visible</p>
        <p className="mt-1 text-sm leading-snug">
          <span className="font-semibold">{visibleName}</span> — has the trailer until Sat. 12
          borrows total.
        </p>
      </div>
      <div
        data-testid="visibility-preview-hidden"
        className="rounded-2xl border border-workshop/15 dark:border-surface-light/15 bg-surface-light/60 dark:bg-workshop/40 p-4"
      >
        <p className="text-[11px] uppercase tracking-wide opacity-60">Hidden</p>
        <p className="mt-1 text-sm leading-snug">A neighbor has the trailer until Sat.</p>
      </div>
    </div>
  );
}
