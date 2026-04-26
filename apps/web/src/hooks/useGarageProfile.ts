import { useQuery } from "@tanstack/react-query";
import type { NonprofitOrg, TierLabels } from "@garageborrow/shared";

import { api } from "../lib/api";
import { DEFAULT_GARAGE_SLUG } from "./useGarageItems";

export type GarageProfile = {
  id: string;
  name: string;
  city_display: string;
  status: "open" | "closed_until" | "closed_indefinitely";
  closed_until_date?: string;
  payforward_orgs: NonprofitOrg[];
  payforward_intro_copy?: string;
  tier_labels: TierLabels;
  ai_enabled: boolean;
  vouching_required: boolean;
};

export const garageProfileKey = (garage: string) => ["garage-profile", garage] as const;

export function useGarageProfile(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  return useQuery({
    queryKey: garageProfileKey(garageSlug),
    queryFn: ({ signal }) =>
      api.get<{ garage: GarageProfile }>(`/g/${encodeURIComponent(garageSlug)}`, { signal }),
    select: (r) => r.garage,
    staleTime: 5 * 60_000,
  });
}
