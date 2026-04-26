import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Loan } from "@garageborrow/shared";

import { api } from "../lib/api";
import { newIdempotencyKey } from "../lib/idempotency";
import { DEFAULT_GARAGE_SLUG } from "./useGarageItems";

export type ActiveLoan = Loan & {
  borrower_display_name: string;
};

export function activeLoansKey(garage: string): readonly unknown[] {
  return ["admin", "active-loans", garage];
}

export function useActiveLoans(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  return useQuery({
    queryKey: activeLoansKey(garageSlug),
    queryFn: ({ signal }) =>
      api.get<{ loans: ActiveLoan[] }>(`/g/${encodeURIComponent(garageSlug)}/admin/active-loans`, {
        signal,
      }),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useMarkLoanReturned(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  const qc = useQueryClient();
  return useMutation<{ loan: Loan }, Error, { loanId: string }>({
    mutationFn: ({ loanId }) =>
      api.post<{ loan: Loan }>(
        `/g/${encodeURIComponent(garageSlug)}/admin/loans/${encodeURIComponent(loanId)}/return`,
        {},
        { idempotencyKey: newIdempotencyKey() },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: activeLoansKey(garageSlug) });
    },
  });
}

export function useSendLoanReminder(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  return useMutation<{ status: string }, Error, { loanId: string }>({
    mutationFn: ({ loanId }) =>
      api.post<{ status: string }>(
        `/g/${encodeURIComponent(garageSlug)}/admin/loans/${encodeURIComponent(loanId)}/remind`,
        {},
        { idempotencyKey: newIdempotencyKey() },
      ),
  });
}
