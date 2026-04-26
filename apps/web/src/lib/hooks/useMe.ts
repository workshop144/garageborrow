import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export type MeProfile = {
  userId: string;
  displayName: string;
  phone: string;
  tier: "howdy" | "friend" | "family" | "owner";
  onboardingSeen: boolean;
};

export function useMe(enabled = true) {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<MeProfile>("/me"),
    enabled,
  });
}
