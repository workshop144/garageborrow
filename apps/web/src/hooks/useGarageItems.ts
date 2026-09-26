import { useQuery } from "@tanstack/react-query";
import type { Item } from "@garageborrow/shared";
import { api } from "../lib/api";

export type ItemAccess = "instant" | "request";

export type GarageItem = Item & {
  access: ItemAccess;
  available_count?: number;
  total_count?: number;
};

type ItemsResponse = { items: GarageItem[] };

export const DEFAULT_GARAGE_SLUG = import.meta.env.VITE_GARAGE_SLUG || "demo-garage";

export function useGarageItems(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  return useQuery({
    queryKey: ["garage-items", garageSlug],
    queryFn: ({ signal }) =>
      api.get<ItemsResponse>(`/g/${encodeURIComponent(garageSlug)}/items`, { signal }),
    select: (data) => data.items,
    staleTime: 30_000,
  });
}
