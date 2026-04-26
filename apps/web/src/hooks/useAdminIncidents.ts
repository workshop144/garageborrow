import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { IncidentReport, IncidentStatus } from "@garageborrow/shared";

import { api } from "../lib/api";
import { newIdempotencyKey } from "../lib/idempotency";
import { DEFAULT_GARAGE_SLUG } from "./useGarageItems";

type IncidentsPage = { incidents: IncidentReport[]; next_cursor?: string };

export function adminIncidentsKey(
  garage: string,
  status: IncidentStatus | "all",
): readonly unknown[] {
  return ["admin", "incidents", garage, status];
}

export function useAdminIncidents(
  status: IncidentStatus | "all" = "open",
  garageSlug: string = DEFAULT_GARAGE_SLUG,
) {
  return useInfiniteQuery({
    queryKey: adminIncidentsKey(garageSlug, status),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const qs = new URLSearchParams();
      if (status !== "all") qs.set("status", status);
      if (pageParam) qs.set("cursor", pageParam);
      const s = qs.toString();
      return api.get<IncidentsPage>(
        `/g/${encodeURIComponent(garageSlug)}/admin/incidents${s ? `?${s}` : ""}`,
        { signal },
      );
    },
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 30_000,
  });
}

export function useUpdateIncident(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  const qc = useQueryClient();
  return useMutation<
    { incident: IncidentReport },
    Error,
    { incidentId: string; status?: IncidentStatus; resolution_notes?: string }
  >({
    mutationFn: ({ incidentId, status, resolution_notes }) =>
      api.patch<{ incident: IncidentReport }>(
        `/g/${encodeURIComponent(garageSlug)}/admin/incidents/${encodeURIComponent(incidentId)}`,
        {
          ...(status ? { status } : {}),
          ...(resolution_notes !== undefined ? { resolution_notes } : {}),
        },
        { idempotencyKey: newIdempotencyKey() },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "incidents", garageSlug] });
    },
  });
}
