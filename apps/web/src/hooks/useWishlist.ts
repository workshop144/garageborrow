import { useInfiniteQuery } from "@tanstack/react-query";
import type { WishlistRequest, WishlistRequestStatus } from "@garageborrow/shared";

import { api } from "../lib/api";
import { DEFAULT_GARAGE_SLUG } from "./useGarageItems";

// Member view of a request: another member's phone is "***1234", or null when
// that member is hidden or leaving; the owner and the subject see full numbers.
export type WishlistRow = Omit<WishlistRequest, "requester_phone" | "decided_by_phone"> & {
  requester_phone: string | null;
  decided_by_phone?: string | null;
  my_vote: boolean;
};

type ListResponse = { items: WishlistRow[]; next_cursor?: string };

export type WishlistFilter = WishlistRequestStatus | "all";

export const wishlistQueryKey = (garage: string, status: WishlistFilter = "open") =>
  ["wishlist", garage, status] as const;

// Cursor-paginated wishlist list, infinite-scrolled. The server already
// returns rows in vote-desc order; we expose a flat `pages` slice for the
// list view.
export function useWishlist(
  garageSlug: string = DEFAULT_GARAGE_SLUG,
  status: WishlistFilter = "open",
) {
  return useInfiniteQuery({
    queryKey: wishlistQueryKey(garageSlug, status),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      params.set("status", status);
      if (pageParam) params.set("cursor", pageParam);
      return api.get<ListResponse>(
        `/g/${encodeURIComponent(garageSlug)}/wishlist?${params.toString()}`,
        { signal },
      );
    },
    getNextPageParam: (last) => last.next_cursor,
  });
}
