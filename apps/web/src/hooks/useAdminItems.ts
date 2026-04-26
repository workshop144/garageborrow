import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Instance, Item } from "@garageborrow/shared";

import { api } from "../lib/api";
import { newIdempotencyKey } from "../lib/idempotency";
import { DEFAULT_GARAGE_SLUG } from "./useGarageItems";

export type AdminItem = Item & {
  available_count: number;
  total_count: number;
  borrows_total: number;
  borrows_last_30d: number;
};

export type AdminItemsPage = { items: AdminItem[]; next_cursor?: string };

export type AdminItemsFilters = {
  q?: string | undefined;
  category?: string | undefined;
  available_now?: boolean | undefined;
  sort?: "recent" | "popular" | "alphabetical" | undefined;
};

export function adminItemsKey(garage: string, filters: AdminItemsFilters): readonly unknown[] {
  return ["admin", "items", garage, filters];
}

function buildItemsQuery(filters: AdminItemsFilters, cursor?: string): string {
  const qs = new URLSearchParams();
  if (filters.q) qs.set("q", filters.q);
  if (filters.category) qs.set("category", filters.category);
  if (filters.available_now) qs.set("available_now", "true");
  if (filters.sort) qs.set("sort", filters.sort);
  if (cursor) qs.set("cursor", cursor);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export function useAdminItems(
  filters: AdminItemsFilters = {},
  garageSlug: string = DEFAULT_GARAGE_SLUG,
) {
  return useInfiniteQuery({
    queryKey: adminItemsKey(garageSlug, filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<AdminItemsPage>(
        `/g/${encodeURIComponent(garageSlug)}/items${buildItemsQuery(filters, pageParam)}`,
        { signal },
      ),
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 15_000,
  });
}

export type ItemPatchBody = {
  name?: string | undefined;
  description?: string | undefined;
  category?: string | undefined;
  primary_photo_key?: string | undefined;
  handling_notes?: string | undefined;
  default_duration_days?: number | undefined;
  requires_approval?: boolean | undefined;
  min_tier?: "howdy" | "friend" | "family" | undefined;
  auto_approve_tier?: "howdy" | "friend" | "family" | undefined;
  approx_value?: number | undefined;
  tags?: string[] | undefined;
};

export function useUpdateAdminItem(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  const qc = useQueryClient();
  return useMutation<{ item: Item }, Error, { itemId: string; body: ItemPatchBody }>({
    mutationFn: ({ itemId, body }) =>
      api.patch<{ item: Item }>(
        `/g/${encodeURIComponent(garageSlug)}/items/${encodeURIComponent(itemId)}`,
        body,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "items", garageSlug] });
      void qc.invalidateQueries({ queryKey: ["garage-items", garageSlug] });
    },
  });
}

export function useCreateAdminItem(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  const qc = useQueryClient();
  return useMutation<{ item: Item }, Error, ItemPatchBody>({
    mutationFn: (body) =>
      api.post<{ item: Item }>(`/g/${encodeURIComponent(garageSlug)}/items`, body, {
        idempotencyKey: newIdempotencyKey(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "items", garageSlug] });
      void qc.invalidateQueries({ queryKey: ["garage-items", garageSlug] });
    },
  });
}

export function useRetireAdminItem(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  const qc = useQueryClient();
  return useMutation<{ item: Item }, Error, { itemId: string }>({
    mutationFn: ({ itemId }) =>
      api.post<{ item: Item }>(
        `/g/${encodeURIComponent(garageSlug)}/items/${encodeURIComponent(itemId)}/retire`,
        {},
        { idempotencyKey: newIdempotencyKey() },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "items", garageSlug] });
    },
  });
}

export function useCreateInstance(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  const qc = useQueryClient();
  return useMutation<
    { instance: Instance },
    Error,
    { itemId: string; label: string; quality_tier: string; notes?: string }
  >({
    mutationFn: ({ itemId, label, quality_tier, notes }) =>
      api.post<{ instance: Instance }>(
        `/g/${encodeURIComponent(garageSlug)}/items/${encodeURIComponent(itemId)}/instances`,
        { label, quality_tier, ...(notes ? { notes } : {}) },
        { idempotencyKey: newIdempotencyKey() },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "items", garageSlug] });
    },
  });
}

export type BulkImportResult = {
  total: number;
  created: number;
  errors: number;
  results: Array<
    | { index: number; status: "ok"; item: Item }
    | { index: number; status: "error"; errors: { path: string; message: string }[] }
  >;
};

export function useBulkImportItems(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  const qc = useQueryClient();
  return useMutation<BulkImportResult, Error, { rows: Record<string, unknown>[] }>({
    mutationFn: ({ rows }) =>
      api.post<BulkImportResult>(
        `/g/${encodeURIComponent(garageSlug)}/admin/items/bulk`,
        { rows },
        { idempotencyKey: newIdempotencyKey() },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "items", garageSlug] });
    },
  });
}
