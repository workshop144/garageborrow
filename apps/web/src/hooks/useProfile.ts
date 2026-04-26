import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@garageborrow/shared";

import { api } from "../lib/api";

export type MeResponse = {
  user: User;
  memberships?: Array<{
    garage_id: string;
    tier: "howdy" | "friend" | "family";
    borrows_total: number;
    returns_on_time: number;
    borrows_active: number;
  }>;
};

export const PROFILE_QUERY_KEY = ["me", "profile"] as const;

export function useProfile() {
  return useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: () => api.get<MeResponse>("/me"),
    staleTime: 30_000,
  });
}

export type ProfileUpdate = Partial<{
  display_name: string;
  visibility: "visible" | "hidden";
  notification_prefs: Partial<User["notification_prefs"]>;
}>;

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation<{ user: User }, Error, ProfileUpdate>({
    mutationFn: (body) => api.patch<{ user: User }>("/me", body),
    onSuccess: (data) => {
      const prev = qc.getQueryData<MeResponse>(PROFILE_QUERY_KEY);
      const next: MeResponse =
        prev?.memberships !== undefined
          ? { user: data.user, memberships: prev.memberships }
          : { user: data.user };
      qc.setQueryData<MeResponse>(PROFILE_QUERY_KEY, next);
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}
