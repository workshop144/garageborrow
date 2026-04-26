import type { DonateDraft } from "../../hooks/useDonate";

type Props = {
  draft: DonateDraft;
};

const CONDITION_LABEL: Record<string, string> = {
  new: "New",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
};

export function StepConfirm({ draft }: Props): JSX.Element {
  return (
    <div className="space-y-4" data-testid="donate-step-confirm">
      <header>
        <h2 className="font-heading text-2xl">Ready to send it Dad&apos;s way?</h2>
        <p className="mt-1 text-sm opacity-80">
          Dad will look at this and either welcome it into the garage or let you know it&apos;s not
          a fit. No pressure either way.
        </p>
      </header>

      <dl className="space-y-3 rounded-xl border border-workshop/15 dark:border-surface-light/15 p-3 text-sm">
        <Field label="Name">{draft.itemName || "—"}</Field>
        {draft.description ? <Field label="Description">{draft.description}</Field> : null}
        <Field label="Photos">
          {draft.photos.length === 0 ? (
            "—"
          ) : (
            <div className="mt-1 grid grid-cols-3 gap-2">
              {draft.photos.map((p, idx) => (
                <img
                  key={p.previewUrl}
                  src={p.previewUrl}
                  alt=""
                  className="aspect-square w-full rounded-lg object-cover"
                  data-testid={`donate-confirm-photo-${idx}`}
                />
              ))}
            </div>
          )}
        </Field>
        <Field label="Condition">
          {draft.condition ? (CONDITION_LABEL[draft.condition] ?? draft.condition) : "—"}
        </Field>
        {draft.notes ? <Field label="Notes">{draft.notes}</Field> : null}
        {draft.suggestedCategory ? (
          <Field label="Suggested category">{draft.suggestedCategory}</Field>
        ) : null}
      </dl>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide opacity-70">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
