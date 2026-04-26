import { useState } from "react";
import type { ActiveLoan } from "../../../hooks/useActiveLoans";
import { useMarkLoanReturned, useSendLoanReminder } from "../../../hooks/useActiveLoans";
import { formatRelative } from "../../../lib/dates";

type Props = { loan: ActiveLoan; itemName?: string | undefined };

type Urgency = "ok" | "due" | "overdue";

function urgencyOf(expectedReturnAt: string, now: Date = new Date()): Urgency {
  const expected = new Date(expectedReturnAt).getTime();
  const ms = expected - now.getTime();
  if (ms < 0) return "overdue";
  if (ms < 24 * 60 * 60 * 1000) return "due";
  return "ok";
}

const URGENCY_STYLES: Record<Urgency, string> = {
  ok: "border-status-available/40 bg-status-available/10",
  due: "border-status-out/40 bg-status-out/10",
  overdue: "border-status-overdue/40 bg-status-overdue/10",
};

export function ActiveLoanRow({ loan, itemName }: Props): JSX.Element {
  const urgency = urgencyOf(loan.expected_return_at);
  const markReturned = useMarkLoanReturned();
  const sendReminder = useSendLoanReminder();
  const [reminderSent, setReminderSent] = useState(false);

  const phone = loan.borrower_phone;
  const tel = `tel:${phone}`;
  const sms = `sms:${phone}`;

  return (
    <div
      data-testid={`active-loan-${loan.id}`}
      className={`rounded-2xl border p-4 ${URGENCY_STYLES[urgency]}`}
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <p className="font-semibold">{itemName ?? loan.item_id}</p>
          <p className="text-sm opacity-80">
            <span className="font-medium">{loan.borrower_display_name}</span>{" "}
            <a className="underline" href={tel}>
              {phone}
            </a>{" "}
            ·{" "}
            <a className="underline" href={sms}>
              text
            </a>
          </p>
        </div>
        <div className="text-right text-sm">
          <p>Borrowed {formatRelative(loan.borrowed_at)}</p>
          <p className="opacity-80">Due {formatRelative(loan.expected_return_at)}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => markReturned.mutate({ loanId: loan.id })}
          disabled={markReturned.isPending}
          className="rounded-xl bg-gold-bright px-3 py-2 text-sm font-semibold text-workshop disabled:opacity-50"
        >
          {markReturned.isPending ? "Marking…" : "Mark returned"}
        </button>
        <button
          type="button"
          onClick={() => {
            sendReminder.mutate({ loanId: loan.id }, { onSuccess: () => setReminderSent(true) });
          }}
          disabled={sendReminder.isPending}
          className="rounded-xl border border-workshop/20 dark:border-surface-light/20 px-3 py-2 text-sm disabled:opacity-50"
        >
          {sendReminder.isPending ? "Sending…" : reminderSent ? "Reminder sent" : "Send reminder"}
        </button>
      </div>
    </div>
  );
}

export { urgencyOf };
