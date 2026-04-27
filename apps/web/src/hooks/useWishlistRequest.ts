import { useQuery } from "@tanstack/react-query";

import { api } from "../lib/api";
import { DEFAULT_GARAGE_SLUG } from "./useGarageItems";
import type { WishlistRow } from "./useWishlist";

export type WishlistDetail = {
  request: WishlistRow;
  voters: Array<{ phone: string; display_name: string | null }>;
  requester_display_name: string | null;
};

export const wishlistDetailKey = (garage: string, id: string) =>
  ["wishlist-detail", garage, id] as const;

export function useWishlistRequest(id: string, garageSlug: string = DEFAULT_GARAGE_SLUG) {
  return useQuery({
    queryKey: wishlistDetailKey(garageSlug, id),
    queryFn: ({ signal }) =>
      api.get<WishlistDetail>(`/g/${encodeURIComponent(garageSlug)}/wishlist/${id}`, { signal }),
    enabled: Boolean(id),
  });
}
