import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Reservation } from "@garageborrow/shared";

import { api } from "../lib/api";
import { newIdempotencyKey } from "../lib/idempotency";
import { DEFAULT_GARAGE_SLUG } from "./useGarageItems";
import { toolDetailQueryKey } from "./useToolDetail";

export type ReservationInput = {
  itemId: string;
  instanceId?: string;
  startAtUtc: string;
  endAtUtc: string;
};

type ReservationResponse = { reservation: Reservation; created_at: string };

export function useReservation(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  const qc = useQueryClient();
  return useMutation<Reservation, Error, ReservationInput>({
    mutationFn: async (input) => {
      const body: Record<string, unknown> = {
        item_id: input.itemId,
        start_at: input.startAtUtc,
        end_at: input.endAtUtc,
      };
      if (input.instanceId) body["instance_id"] = input.instanceId;
      const res = await api.post<ReservationResponse>(
        `/g/${encodeURIComponent(garageSlug)}/reservations`,
        body,
        { idempotencyKey: newIdempotencyKey() },
      );
      return res.reservation;
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: toolDetailQueryKey(garageSlug, vars.itemId) });
    },
  });
}
