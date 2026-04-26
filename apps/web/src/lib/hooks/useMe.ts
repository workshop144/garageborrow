import { useQuery } from "@tanstack/react-query";
import type { GarageMembership, User } from "@garageborrow/shared";
import { api } from "../api";

export type MeProfile = {
  userId: string;
  displayName: string;
  phone: string;
  tier: "howdy" | "friend" | "family" | "owner";
  onboardingSeen: boolean;
  ownedGarages: string[];
  celebrationPending: boolean;
};

type MeResponse = {
  user: User;
  memberships?: GarageMembership[];
  owned_garages?: string[];
  tier?: "howdy" | "friend" | "family" | "owner";
  celebration_pending?: boolean;
};

function mapMe(r: MeResponse): MeProfile {
  return {
    userId: r.user.phone,
    displayName: r.user.display_name,
    phone: r.user.phone,
    tier: r.tier ?? "howdy",
    onboardingSeen: false,
    ownedGarages: r.owned_garages ?? [],
    celebrationPending: r.celebration_pending ?? false,
  };
}

export function useMe(enabled = true) {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const r = await api.get<MeResponse>("/me");
      return mapMe(r);
    },
    enabled,
  });
}
