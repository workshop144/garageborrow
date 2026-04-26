import { useInfiniteQuery } from "@tanstack/react-query";
import type { DonationOffer } from "@garageborrow/shared";

import { api } from "../lib/api";

export type MyDonationsPage = {
  donations: DonationOffer[];
  next_cursor?: string;
};

export const myDonationsQueryKey = () => ["me", "donations"] as const;

export function useMyDonations() {
  return useInfiniteQuery({
    queryKey: myDonationsQueryKey(),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const qs = pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : "";
      return api.get<MyDonationsPage>(`/me/donations${qs}`, { signal });
    },
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 30_000,
  });
}
