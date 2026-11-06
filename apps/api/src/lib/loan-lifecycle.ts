// Loan transitions shared by the API routes and the notifier cron: closing a
// loan as returned and the 48h auto-confirm of a borrower's return claim.

import { bumpMemberCounter, listOverdueAutoConfirm, type LoanRecord, updateLoan } from "./repo.js";

export const AUTO_CONFIRM_AFTER_MS = 48 * 3600_000;

// Member counters for a loan that just became `returned`: it is no longer
// out, and it came back on time or late. "Came back" is the borrower's claim
// when there is one, otherwise the moment the owner closed it.
export async function settleReturnCounters(loan: LoanRecord, returnedAtIso: string): Promise<void> {
  const late = Date.parse(returnedAtIso) > Date.parse(loan.expected_return_at);
  await bumpMemberCounter(loan.garage_id, loan.borrower_phone, "borrows_active", -1);
  await bumpMemberCounter(
    loan.garage_id,
    loan.borrower_phone,
    late ? "returns_late" : "returns_on_time",
    1,
  );
}

// After 48h without a dispute, a claimed return becomes status=returned.
// Each flip is conditional on the loan row being unchanged since it was read,
// so a concurrent owner return, dispute or second sweep cannot double-count.
// Returns the loans this call confirmed.
export async function confirmClaimedReturns(
  garage_id: string,
  cutoffMs = Date.now() - AUTO_CONFIRM_AFTER_MS,
): Promise<LoanRecord[]> {
  const cutoffIso = new Date(cutoffMs).toISOString();
  const candidates = await listOverdueAutoConfirm(garage_id, cutoffIso);
  const confirmed: LoanRecord[] = [];
  for (const loan of candidates) {
    const next: LoanRecord = { ...loan, status: "returned" };
    if (!(await updateLoan(next, loan))) continue;
    await settleReturnCounters(loan, loan.actual_return_at ?? loan.return_claimed_at!);
    confirmed.push(next);
  }
  return confirmed;
}
