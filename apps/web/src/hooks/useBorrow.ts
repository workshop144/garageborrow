import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Loan, Reservation } from "@garageborrow/shared";

import { api } from "../lib/api";
import { newIdempotencyKey } from "../lib/idempotency";
import { DEFAULT_GARAGE_SLUG } from "./useGarageItems";
import { toolDetailQueryKey } from "./useToolDetail";

export type BorrowInput = {
  itemId: string;
  instanceId?: string;
  durationDays: number;
  liabilityCopyVersion: string;
  note?: string;
};

export type BorrowSuccess =
  | { kind: "loan"; loan: Loan }
  | { kind: "reservation"; reservation: Reservation; message?: string };

type LoanResponse = { loan: Loan };
type ReservationResponse = { reservation: Reservation; message?: string };

export function useBorrow(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  const qc = useQueryClient();
  return useMutation<BorrowSuccess, Error, BorrowInput>({
    mutationFn: async (input) => {
      const body: Record<string, unknown> = {
        item_id: input.itemId,
        liability_acknowledged: true,
        liability_copy_version: input.liabilityCopyVersion,
        duration_days: input.durationDays,
      };
      if (input.instanceId) body["instance_id"] = input.instanceId;
      if (input.note) body["note"] = input.note;
      const idempotencyKey = newIdempotencyKey();
      const result = await api.post<LoanResponse | ReservationResponse>(
        `/g/${encodeURIComponent(garageSlug)}/loans`,
        body,
        { idempotencyKey },
      );
      if ("loan" in result) {
        return { kind: "loan", loan: result.loan };
      }
      return {
        kind: "reservation",
        reservation: result.reservation,
        ...(result.message !== undefined ? { message: result.message } : {}),
      };
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: toolDetailQueryKey(garageSlug, vars.itemId) });
      void qc.invalidateQueries({ queryKey: ["garage-items", garageSlug] });
    },
  });
}
