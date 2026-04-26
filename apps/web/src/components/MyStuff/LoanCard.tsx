import { useState } from "react";
import { Link } from "react-router-dom";

import { ExtensionDrawer } from "../Drawers/ExtensionDrawer";
import { formatRelative } from "../../lib/dates";
import { useReturnLoan } from "../../hooks/useMyStuff";
import type { MyLoan } from "../../hooks/useMyStuff";

type Props = {
  loan: MyLoan;
};

export function LoanCard({ loan }: Props): JSX.Element {
  const [extOpen, setExtOpen] = useState(false);
  const returnLoan = useReturnLoan();
  const overdue = loan.loan.status === "overdue" || isOverdue(loan.loan.expected_return_at);

  return (
    <article
      data-testid="loan-card"
      className="rounded-2xl border border-workshop/10 dark:border-surface-light/10 bg-surface-light/60 dark:bg-workshop/40 p-4"
    >
      <div className="flex gap-3">
        <div
          aria-hidden="true"
          className="h-16 w-16 flex-none overflow-hidden rounded-xl bg-workshop/10 dark:bg-surface-light/10"
        >
          {loan.item.primary_photo_key ? (
            <img
              src={loan.item.primary_photo_key}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <Link
            to={`/tool/${encodeURIComponent(loan.item.id)}`}
            className="font-heading text-lg leading-snug hover:underline"
          >
            {loan.item.name}
          </Link>
          <p className="text-xs opacity-70">
            Borrowed {formatRelative(loan.loan.borrowed_at)} · due{" "}
            {formatRelative(loan.loan.expected_return_at)}
          </p>
          {overdue ? (
            <p className="mt-2 rounded-lg bg-status-overdue/10 border border-status-overdue/30 px-3 py-2 text-xs">
              Just checking in. No rush — extend if you need it.
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => returnLoan.mutate({ loanId: loan.loan.id })}
          disabled={returnLoan.isPending}
          className="rounded-xl border border-workshop/20 dark:border-surface-light/20 px-3 py-1.5 text-sm hover:bg-workshop/5 dark:hover:bg-surface-light/5 disabled:opacity-60"
        >
          {returnLoan.isPending ? "Marking…" : "Mark returned"}
        </button>
        <button
          type="button"
          onClick={() => setExtOpen(true)}
          className="rounded-xl bg-gold-bright px-3 py-1.5 text-sm font-semibold text-workshop"
        >
          Need it longer
        </button>
      </div>
      <ExtensionDrawer
        open={extOpen}
        onClose={() => setExtOpen(false)}
        loanId={loan.loan.id}
        currentReturnAtUtc={loan.loan.expected_return_at}
        onExtended={() => setExtOpen(false)}
      />
    </article>
  );
}

function isOverdue(expectedReturnUtc: string): boolean {
  return new Date(expectedReturnUtc).getTime() < Date.now();
}
