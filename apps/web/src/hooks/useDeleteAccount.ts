import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../lib/api";
import { newIdempotencyKey } from "../lib/idempotency";

export type DeleteAccountResponse = {
  status: "deletion_requested" | "deletion_cancelled";
  scheduled_for_hard_delete_at?: string;
};

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation<DeleteAccountResponse, Error, void>({
    mutationFn: () =>
      api.post<DeleteAccountResponse>("/me/delete-request", undefined, {
        idempotencyKey: newIdempotencyKey(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useCancelDelete() {
  const qc = useQueryClient();
  return useMutation<DeleteAccountResponse, Error, void>({
    mutationFn: () =>
      api.post<DeleteAccountResponse>("/me/delete-request/cancel", undefined, {
        idempotencyKey: newIdempotencyKey(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}
