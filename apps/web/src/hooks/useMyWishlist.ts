import { useInfiniteQuery } from "@tanstack/react-query";

import { api } from "../lib/api";
import type { WishlistRow } from "./useWishlist";

type Response = { items: WishlistRow[]; next_cursor?: string };

export const myWishlistKey = () => ["my-wishlist"] as const;

export function useMyWishlist() {
  return useInfiniteQuery({
    queryKey: myWishlistKey(),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("cursor", pageParam);
      const qs = params.toString();
      return api.get<Response>(`/me/wishlist${qs ? `?${qs}` : ""}`, { signal });
    },
    getNextPageParam: (last) => last.next_cursor,
  });
}
