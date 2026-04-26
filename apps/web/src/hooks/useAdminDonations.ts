import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { DonationOffer, Item, TierName } from "@garageborrow/shared";

import { api } from "../lib/api";
import { newIdempotencyKey } from "../lib/idempotency";
import { DEFAULT_GARAGE_SLUG } from "./useGarageItems";

type DonationsPage = { donations: DonationOffer[]; next_cursor?: string };

export function adminDonationsKey(garage: string): readonly unknown[] {
  return ["admin", "donations", garage];
}

export function useAdminDonations(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  return useInfiniteQuery({
    queryKey: adminDonationsKey(garageSlug),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const qs = pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : "";
      return api.get<DonationsPage>(`/g/${encodeURIComponent(garageSlug)}/admin/donations${qs}`, {
        signal,
      });
    },
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 30_000,
  });
}

export type AcceptDonationOverrides = Partial<{
  category: string;
  primary_photo_key: string;
  handling_notes: string;
  min_tier: TierName;
  auto_approve_tier: TierName;
}>;

type DecideDonationVars =
  | {
      donationId: string;
      decision: "accept";
      item_overrides?: AcceptDonationOverrides;
      owner_notes?: string;
    }
  | {
      donationId: string;
      decision: "decline";
      decline_reason: string;
      owner_notes?: string;
    };

export function useDecideDonation(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  const qc = useQueryClient();
  return useMutation<{ donation: DonationOffer; item?: Item }, Error, DecideDonationVars>({
    mutationFn: (vars) => {
      const { donationId, ...rest } = vars;
      return api.post<{ donation: DonationOffer; item?: Item }>(
        `/g/${encodeURIComponent(garageSlug)}/admin/donations/${encodeURIComponent(donationId)}/decide`,
        rest,
        { idempotencyKey: newIdempotencyKey() },
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminDonationsKey(garageSlug) });
      void qc.invalidateQueries({ queryKey: ["admin", "items", garageSlug] });
    },
  });
}
