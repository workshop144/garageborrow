import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Loan } from "@garageborrow/shared";

import { api } from "../lib/api";
import { newIdempotencyKey } from "../lib/idempotency";
import { DEFAULT_GARAGE_SLUG } from "./useGarageItems";

export type ExtensionInput = {
  loanId: string;
  // The user's chosen extension. The server today extends by a fixed step;
  // we still ship the requested target so the API can honor it once it
  // accepts a custom extend duration.
  newReturnAtUtc: string;
};

type ExtensionResponse = { loan: Loan };

export function useExtension(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  const qc = useQueryClient();
  return useMutation<Loan, Error, ExtensionInput>({
    mutationFn: async (input) => {
      const res = await api.post<ExtensionResponse>(
        `/g/${encodeURIComponent(garageSlug)}/loans/${encodeURIComponent(input.loanId)}/extend`,
        { new_expected_return_at: input.newReturnAtUtc },
        { idempotencyKey: newIdempotencyKey() },
      );
      return res.loan;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["my-stuff", garageSlug] });
    },
  });
}
