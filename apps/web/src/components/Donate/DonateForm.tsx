import { Link } from "react-router-dom";

import { DONATE_STEP_ORDER, useDonate } from "../../hooks/useDonate";
import type { DonationCondition } from "@garageborrow/shared";
import { StepCategory } from "./StepCategory";
import { StepCondition } from "./StepCondition";
import { StepConfirm } from "./StepConfirm";
import { StepName } from "./StepName";
import { StepNotes } from "./StepNotes";
import { StepPhotos } from "./StepPhotos";

const STEP_LABELS: Record<(typeof DONATE_STEP_ORDER)[number], string> = {
  name: "What",
  photos: "Photos",
  condition: "Condition",
  notes: "Notes",
  category: "Category",
  confirm: "Confirm",
};

export function DonateForm(): JSX.Element {
  const d = useDonate();

  if (d.submittedDonation) {
    return (
      <section
        className="space-y-4 rounded-xl border border-gold-bright/40 bg-gold-bright/10 p-4"
        data-testid="donate-success"
      >
        <h2 className="font-heading text-2xl">Thanks for the offer.</h2>
        <p className="text-sm">
          We&apos;ll let you know either way. You can check on it any time from your{" "}
          <Link to="/me/donations" className="font-semibold underline">
            My Donations
          </Link>{" "}
          page.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/"
            className="rounded-xl bg-gold-bright px-3 py-2 text-sm font-semibold text-workshop"
            data-testid="donate-success-pegboard"
          >
            Back to the pegboard
          </Link>
          <button
            type="button"
            onClick={d.reset}
            className="rounded-xl border border-workshop/15 dark:border-surface-light/15 px-3 py-2 text-sm"
            data-testid="donate-success-another"
          >
            Donate something else
          </button>
        </div>
      </section>
    );
  }

  const stepIndex = DONATE_STEP_ORDER.indexOf(d.step);
  const isLast = d.step === "confirm";

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (isLast) {
          d.submit();
        } else if (d.canAdvance) {
          d.goNext();
        }
      }}
      data-testid="donate-form"
    >
      <Stepper stepIndex={stepIndex} />

      {d.step === "name" ? (
        <StepName
          name={d.draft.itemName}
          description={d.draft.description}
          onChange={({ name, description }) => {
            if (name !== undefined) d.setField("itemName", name);
            if (description !== undefined) d.setField("description", description);
          }}
        />
      ) : null}
      {d.step === "photos" ? (
        <StepPhotos photos={d.draft.photos} onChange={(next) => d.setField("photos", next)} />
      ) : null}
      {d.step === "condition" ? (
        <StepCondition
          value={d.draft.condition}
          onChange={(c: DonationCondition) => d.setField("condition", c)}
        />
      ) : null}
      {d.step === "notes" ? (
        <StepNotes value={d.draft.notes} onChange={(v) => d.setField("notes", v)} />
      ) : null}
      {d.step === "category" ? (
        <StepCategory
          value={d.draft.suggestedCategory}
          onChange={(v) => d.setField("suggestedCategory", v)}
        />
      ) : null}
      {d.step === "confirm" ? <StepConfirm draft={d.draft} /> : null}

      {d.submitError ? (
        <p
          className="rounded-xl border border-status-overdue/40 bg-status-overdue/10 p-3 text-sm"
          data-testid="donate-error"
        >
          We couldn&apos;t send that just yet — {d.submitError.message}
        </p>
      ) : null}

      <div className="flex justify-between gap-2">
        <button
          type="button"
          onClick={d.goBack}
          disabled={stepIndex === 0 || d.submitting}
          className="rounded-xl border border-workshop/15 dark:border-surface-light/15 px-3 py-2 text-sm disabled:opacity-40"
          data-testid="donate-back"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={!d.canAdvance || d.submitting}
          className="rounded-xl bg-gold-bright px-4 py-2 text-sm font-semibold text-workshop disabled:opacity-50"
          data-testid={isLast ? "donate-submit" : "donate-next"}
        >
          {isLast ? (d.submitting ? "Sending…" : "Submit") : "Next"}
        </button>
      </div>
    </form>
  );
}

function Stepper({ stepIndex }: { stepIndex: number }): JSX.Element {
  return (
    <ol
      className="flex items-center gap-1 text-[11px] uppercase tracking-wide"
      data-testid="donate-stepper"
    >
      {DONATE_STEP_ORDER.map((s, i) => {
        const active = i === stepIndex;
        const done = i < stepIndex;
        return (
          <li
            key={s}
            className={`flex-1 rounded-md px-2 py-1 text-center ${
              active
                ? "bg-gold-bright text-workshop font-semibold"
                : done
                  ? "bg-workshop/10 dark:bg-surface-light/10"
                  : "opacity-50"
            }`}
          >
            {STEP_LABELS[s]}
          </li>
        );
      })}
    </ol>
  );
}
