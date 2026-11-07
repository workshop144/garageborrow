import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Item, Loan, Reservation, WaitlistEntry } from "@garageborrow/shared";

import { api } from "../lib/api";
import { newIdempotencyKey } from "../lib/idempotency";
import { DEFAULT_GARAGE_SLUG } from "./useGarageItems";

export type MyLoan = {
  loan: Loan;
  item: Pick<Item, "id" | "name" | "primary_photo_key" | "category">;
};

export type MyReservation = {
  reservation: Reservation;
  item: Pick<Item, "id" | "name" | "primary_photo_key">;
};

export type MyWaitlistEntry = {
  entry: WaitlistEntry;
  item: Pick<Item, "id" | "name" | "primary_photo_key">;
};

export type MyStuffResponse = {
  loans: MyLoan[];
  reservations: MyReservation[];
  waitlist: MyWaitlistEntry[];
  stats: {
    borrows_total: number;
    returns_on_time: number;
    borrows_active: number;
  };
};

export function myStuffQueryKey(garageSlug: string): readonly unknown[] {
  return ["my-stuff", garageSlug];
}

export function useMyStuff(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  return useQuery({
    queryKey: myStuffQueryKey(garageSlug),
    queryFn: ({ signal }) =>
      api.get<MyStuffResponse>(`/me/stuff?garage=${encodeURIComponent(garageSlug)}`, {
        signal,
      }),
    staleTime: 15_000,
  });
}

export function useReturnLoan(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  const qc = useQueryClient();
  return useMutation<Loan, Error, { loanId: string }>({
    mutationFn: async ({ loanId }) => {
      const res = await api.post<{ loan: Loan }>(
        `/g/${encodeURIComponent(garageSlug)}/loans/${encodeURIComponent(loanId)}/return`,
        {},
        { idempotencyKey: newIdempotencyKey() },
      );
      return res.loan;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: myStuffQueryKey(garageSlug) });
    },
  });
}

export function useCancelReservation(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  const qc = useQueryClient();
  return useMutation<void, Error, { reservationId: string }>({
    mutationFn: async ({ reservationId }) => {
      await api.delete<void>(
        `/g/${encodeURIComponent(garageSlug)}/reservations/${encodeURIComponent(reservationId)}`,
      );
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: myStuffQueryKey(garageSlug) });
    },
  });
}

export function useLeaveWaitlistFromMyStuff(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  const qc = useQueryClient();
  return useMutation<void, Error, { entryId: string }>({
    mutationFn: async ({ entryId }) => {
      await api.delete<void>(
        `/g/${encodeURIComponent(garageSlug)}/waitlist/${encodeURIComponent(entryId)}`,
      );
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: myStuffQueryKey(garageSlug) });
    },
  });
}
