import { useQuery } from "@tanstack/react-query";
import type { Instance, ItemDetail } from "@garageborrow/shared";

import { api } from "../lib/api";
import { DEFAULT_GARAGE_SLUG } from "./useGarageItems";

export type WaitlistMembership = {
  id: string;
  position: number;
};

export type ToolDetailResponse = {
  item: ItemDetail;
  instances: Instance[];
  status_pills: string[];
  handling_notes: string;
  waitlist_size: number;
  my_waitlist_entry: WaitlistMembership | null;
};

export function toolDetailQueryKey(garageSlug: string, itemId: string): readonly unknown[] {
  return ["tool-detail", garageSlug, itemId];
}

export function useToolDetail(
  itemId: string | undefined,
  garageSlug: string = DEFAULT_GARAGE_SLUG,
) {
  return useQuery({
    queryKey: toolDetailQueryKey(garageSlug, itemId ?? ""),
    enabled: Boolean(itemId),
    queryFn: ({ signal }) =>
      api.get<ToolDetailResponse>(
        `/g/${encodeURIComponent(garageSlug)}/items/${encodeURIComponent(itemId ?? "")}`,
        { signal },
      ),
    staleTime: 15_000,
  });
}
