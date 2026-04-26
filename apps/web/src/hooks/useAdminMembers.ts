import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GarageMembership, TierName } from "@garageborrow/shared";

import { api } from "../lib/api";
import { newIdempotencyKey } from "../lib/idempotency";
import { DEFAULT_GARAGE_SLUG } from "./useGarageItems";

type MembersPage = { members: GarageMembership[]; next_cursor?: string };

export function adminMembersKey(garage: string): readonly unknown[] {
  return ["admin", "members", garage];
}

export function useAdminMembers(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  return useInfiniteQuery({
    queryKey: adminMembersKey(garageSlug),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const qs = pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : "";
      return api.get<MembersPage>(`/g/${encodeURIComponent(garageSlug)}/admin/members${qs}`, {
        signal,
      });
    },
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 30_000,
  });
}

export type PromotionSuggestion = {
  user_phone: string;
  current_tier: TierName;
  suggested_tier: TierName;
  returns_on_time: number;
};

export function usePromotionSuggestions(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  return useQuery({
    queryKey: ["admin", "promotion-suggestions", garageSlug],
    queryFn: ({ signal }) =>
      api.get<{ suggestions: PromotionSuggestion[]; threshold: number }>(
        `/g/${encodeURIComponent(garageSlug)}/admin/promotion-suggestions`,
        { signal },
      ),
    staleTime: 60_000,
  });
}

export type MemberPatchBody = Partial<{
  tier: TierName;
  notes: string;
  ai_budget_override_tokens: number;
}>;

export function useUpdateMember(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  const qc = useQueryClient();
  return useMutation<
    { membership: GarageMembership },
    Error,
    { phone: string; body: MemberPatchBody }
  >({
    mutationFn: ({ phone, body }) =>
      api.patch<{ membership: GarageMembership }>(
        `/g/${encodeURIComponent(garageSlug)}/admin/members/${encodeURIComponent(phone)}`,
        body,
        { idempotencyKey: newIdempotencyKey() },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminMembersKey(garageSlug) });
      void qc.invalidateQueries({ queryKey: ["admin", "promotion-suggestions", garageSlug] });
    },
  });
}
