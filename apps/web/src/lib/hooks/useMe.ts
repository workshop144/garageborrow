import { useQuery } from "@tanstack/react-query";
import type { User } from "@garageborrow/shared";
import { api } from "../api";

export type MeProfile = {
  userId: string;
  displayName: string;
  phone: string;
  // Capabilities only: /v1/me does not reveal the member's tier label.
  isOwner: boolean;
  // Garages where the member's tier reaches that garage's AI minimum.
  aiEligibleGarages: string[];
  onboardingSeen: boolean;
  ownedGarages: string[];
  celebrationPending: boolean;
};

// The member-facing membership view (no tier, notes or vouching details).
export type MeMembership = {
  garage_id: string;
  joined_at: string;
  borrows_total: number;
  borrows_active: number;
  returns_on_time: number;
  returns_late: number;
  celebration_pending: boolean;
};

type MeResponse = {
  user: User;
  memberships?: MeMembership[];
  owned_garages?: string[];
  is_owner?: boolean;
  ai_eligible_garages?: string[];
  celebration_pending?: boolean;
};

function mapMe(r: MeResponse): MeProfile {
  return {
    userId: r.user.phone,
    displayName: r.user.display_name,
    phone: r.user.phone,
    isOwner: r.is_owner ?? (r.owned_garages ?? []).length > 0,
    aiEligibleGarages: r.ai_eligible_garages ?? [],
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
