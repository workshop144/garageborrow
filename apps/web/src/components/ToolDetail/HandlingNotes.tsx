type Props = {
  notes: string;
};

export function HandlingNotes({ notes }: Props): JSX.Element | null {
  if (!notes) return null;
  return (
    <aside
      role="note"
      className="rounded-xl border border-gold-accent/40 bg-gold-accent/10 p-4 text-sm italic text-workshop/90 dark:text-surface-light/90"
    >
      <strong className="not-italic font-semibold text-gold-accent mr-1">Heads up:</strong>
      {notes}
    </aside>
  );
}
