import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../lib/api";
import { DEFAULT_GARAGE_SLUG } from "./useGarageItems";
import { wishlistDetailKey, type WishlistDetail } from "./useWishlistRequest";
import type { WishlistRow } from "./useWishlist";

type VoteResponse = { request: WishlistRow; vote_count: number };

type Vars = { id: string; voted: boolean };

// Optimistic vote toggle. We adjust vote_count and my_vote in the cached list
// pages and the detail record up-front, then roll back if the request fails.
export function useWishlistVote(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  const qc = useQueryClient();
  return useMutation<VoteResponse, Error, Vars, unknown>({
    mutationFn: ({ id, voted }) => {
      if (voted) {
        return api.delete<VoteResponse>(`/g/${encodeURIComponent(garageSlug)}/wishlist/${id}/vote`);
      }
      return api.post<VoteResponse>(`/g/${encodeURIComponent(garageSlug)}/wishlist/${id}/vote`);
    },
    onMutate: async ({ id, voted }) => {
      const detailKey = wishlistDetailKey(garageSlug, id);
      await qc.cancelQueries({ queryKey: ["wishlist", garageSlug] });
      await qc.cancelQueries({ queryKey: detailKey });
      const prevDetail = qc.getQueryData<WishlistDetail>(detailKey);
      if (prevDetail) {
        qc.setQueryData<WishlistDetail>(detailKey, {
          ...prevDetail,
          request: {
            ...prevDetail.request,
            my_vote: !voted,
            vote_count: prevDetail.request.vote_count + (voted ? -1 : 1),
          },
        });
      }
      // Patch any cached list pages.
      const lists = qc.getQueriesData<{ pages: { items: WishlistRow[] }[] }>({
        queryKey: ["wishlist", garageSlug],
      });
      for (const [key, data] of lists) {
        if (!data) continue;
        const next = {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: p.items.map((r) =>
              r.id === id
                ? {
                    ...r,
                    my_vote: !voted,
                    vote_count: r.vote_count + (voted ? -1 : 1),
                  }
                : r,
            ),
          })),
        };
        qc.setQueryData(key, next);
      }
      return { prevDetail, lists };
    },
    onError: (_err, { id }, ctx) => {
      const detailKey = wishlistDetailKey(garageSlug, id);
      const restore = ctx as
        | {
            prevDetail?: WishlistDetail;
            lists?: Array<[unknown, { pages: { items: WishlistRow[] }[] } | undefined]>;
          }
        | undefined;
      if (restore?.prevDetail) {
        qc.setQueryData(detailKey, restore.prevDetail);
      }
      if (restore?.lists) {
        for (const [key, data] of restore.lists) {
          qc.setQueryData(key as readonly unknown[], data);
        }
      }
    },
    onSettled: (_data, _err, { id }) => {
      void qc.invalidateQueries({ queryKey: ["wishlist", garageSlug] });
      void qc.invalidateQueries({ queryKey: wishlistDetailKey(garageSlug, id) });
    },
  });
}
