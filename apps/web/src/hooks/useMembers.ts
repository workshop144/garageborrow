import { useInfiniteQuery } from "@tanstack/react-query";

import { api } from "../lib/api";
import { DEFAULT_GARAGE_SLUG } from "./useGarageItems";

export type MemberDirectoryEntry = {
  phone_last4: string;
  display_name: string;
  joined_at: string;
  active_borrows?: number;
  active_borrow_names?: string[];
  borrows_total?: number;
};

export type MembersPage = {
  members: MemberDirectoryEntry[];
  next_cursor?: string;
};

export function membersQueryKey(garageSlug: string): readonly unknown[] {
  return ["members", garageSlug];
}

export function useMembers(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  return useInfiniteQuery({
    queryKey: membersQueryKey(garageSlug),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const qs = pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : "";
      return api.get<MembersPage>(`/g/${encodeURIComponent(garageSlug)}/members${qs}`, { signal });
    },
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 60_000,
  });
}
