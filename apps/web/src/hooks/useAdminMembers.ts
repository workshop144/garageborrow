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

// Invites: sign-up is invite-only, so an owner adds a neighbor's number here and
// the neighbor then signs in with it.
export type PendingInvite = {
  phone: string;
  tier: TierName;
  created_at: string;
  expires_at: number;
};

export function adminInvitesKey(garage: string): readonly unknown[] {
  return ["admin", "invites", garage];
}

export function useAdminInvites(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  return useQuery({
    queryKey: adminInvitesKey(garageSlug),
    queryFn: ({ signal }) =>
      api.get<{ invites: PendingInvite[] }>(`/g/${encodeURIComponent(garageSlug)}/admin/invites`, {
        signal,
      }),
    staleTime: 30_000,
  });
}

export function useCreateInvite(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  const qc = useQueryClient();
  return useMutation<{ invite: PendingInvite }, Error, { phone: string; tier: TierName }>({
    mutationFn: (body) =>
      api.post<{ invite: PendingInvite }>(
        `/g/${encodeURIComponent(garageSlug)}/admin/invites`,
        body,
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminInvitesKey(garageSlug) }),
  });
}

export function useRevokeInvite(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  const qc = useQueryClient();
  return useMutation<{ status: string }, Error, string>({
    mutationFn: (phone) =>
      api.delete<{ status: string }>(
        `/g/${encodeURIComponent(garageSlug)}/admin/invites/${encodeURIComponent(phone)}`,
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminInvitesKey(garageSlug) }),
  });
}
