import { useQuery } from "@tanstack/react-query";
import type { NonprofitOrg } from "@garageborrow/shared";

import { api } from "../lib/api";
import { DEFAULT_GARAGE_SLUG } from "./useGarageItems";

type GarageProfile = {
  garage: {
    id: string;
    name: string;
    payforward_orgs: NonprofitOrg[];
    payforward_intro_copy?: string;
  };
};

export const payForwardQueryKey = (garage: string) => ["pay-forward", garage] as const;

export function usePayForward(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  return useQuery({
    queryKey: payForwardQueryKey(garageSlug),
    queryFn: ({ signal }) =>
      api.get<GarageProfile>(`/g/${encodeURIComponent(garageSlug)}`, { signal }),
    select: (r) => ({
      orgs: [...r.garage.payforward_orgs].sort(
        (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0),
      ),
      introCopy: r.garage.payforward_intro_copy,
      garageName: r.garage.name,
    }),
    staleTime: 5 * 60_000,
  });
}
