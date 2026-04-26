import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Garage, NonprofitOrg, TierLabels } from "@garageborrow/shared";

import { api } from "../lib/api";
import { newIdempotencyKey } from "../lib/idempotency";
import { DEFAULT_GARAGE_SLUG } from "./useGarageItems";

export function garageSettingsKey(garage: string): readonly unknown[] {
  return ["garage", garage];
}

export function useGarage(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  return useQuery({
    queryKey: garageSettingsKey(garageSlug),
    queryFn: ({ signal }) =>
      api.get<{ garage: Garage }>(`/g/${encodeURIComponent(garageSlug)}/admin/settings`, {
        signal,
      }),
    staleTime: 60_000,
  });
}

export type GarageSettingsPatch = Partial<{
  name: string;
  status: "open" | "closed_until" | "closed_indefinitely";
  closed_until_date: string;
  tier_labels: TierLabels;
  quality_tiers: string[];
  payforward_orgs: NonprofitOrg[];
  payforward_intro_copy: string;
  ai_enabled: boolean;
  ai_min_tier: "howdy" | "friend" | "family";
  ai_total_monthly_cap_cents: number;
  ai_default_user_monthly_tokens: number;
  ai_default_model: "haiku" | "sonnet";
  vouching_required: boolean;
}>;

export function useUpdateGarageSettings(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  const qc = useQueryClient();
  return useMutation<{ garage: Garage }, Error, GarageSettingsPatch>({
    mutationFn: (body) =>
      api.patch<{ garage: Garage }>(`/g/${encodeURIComponent(garageSlug)}/admin/settings`, body, {
        idempotencyKey: newIdempotencyKey(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: garageSettingsKey(garageSlug) });
    },
  });
}
