import { useInfiniteQuery } from "@tanstack/react-query";
import type { AuditLogEntry } from "@garageborrow/shared";

import { api } from "../lib/api";
import { DEFAULT_GARAGE_SLUG } from "./useGarageItems";

type AuditLogPage = { entries: AuditLogEntry[]; next_cursor?: string };

export type AuditLogFilters = {
  action_type?: string | undefined;
  actor_phone?: string | undefined;
  entity_type?: string | undefined;
  since?: string | undefined;
  until?: string | undefined;
};

export function auditLogKey(garage: string, filters: AuditLogFilters): readonly unknown[] {
  return ["admin", "audit-log", garage, filters];
}

export function useAuditLog(
  filters: AuditLogFilters = {},
  garageSlug: string = DEFAULT_GARAGE_SLUG,
) {
  return useInfiniteQuery({
    queryKey: auditLogKey(garageSlug, filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const qs = new URLSearchParams();
      if (filters.action_type) qs.set("action_type", filters.action_type);
      if (filters.actor_phone) qs.set("actor_phone", filters.actor_phone);
      if (filters.entity_type) qs.set("entity_type", filters.entity_type);
      if (filters.since) qs.set("since", filters.since);
      if (filters.until) qs.set("until", filters.until);
      if (pageParam) qs.set("cursor", pageParam);
      const s = qs.toString();
      return api.get<AuditLogPage>(
        `/g/${encodeURIComponent(garageSlug)}/admin/audit-log${s ? `?${s}` : ""}`,
        { signal },
      );
    },
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 15_000,
  });
}
