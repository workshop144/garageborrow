import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../lib/api";
import { DEFAULT_GARAGE_SLUG } from "./useGarageItems";
import type { WishlistRow } from "./useWishlist";

type AcquiredVars = { id: string; decision: "acquired"; acquired_item_id: string };
type DeclinedVars = { id: string; decision: "declined"; decline_reason?: string };
type DuplicateVars = { id: string; decision: "duplicate"; duplicate_of_id: string };
export type DecideVars = AcquiredVars | DeclinedVars | DuplicateVars;

type Response = { request: WishlistRow; transferred_votes?: number };

export function useWishlistDecision(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  const qc = useQueryClient();
  return useMutation<Response, Error, DecideVars>({
    mutationFn: ({ id, ...body }) =>
      api.post<Response>(`/g/${encodeURIComponent(garageSlug)}/admin/wishlist/${id}/decide`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["wishlist", garageSlug] });
    },
  });
}
