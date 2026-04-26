import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { WaitlistEntry } from "@garageborrow/shared";

import { api } from "../lib/api";
import { newIdempotencyKey } from "../lib/idempotency";
import { DEFAULT_GARAGE_SLUG } from "./useGarageItems";
import { toolDetailQueryKey } from "./useToolDetail";
import type { ToolDetailResponse } from "./useToolDetail";

type JoinResponse = { entry: WaitlistEntry };

export function useJoinWaitlist(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  const qc = useQueryClient();
  return useMutation<WaitlistEntry, Error, { itemId: string }, { previous?: ToolDetailResponse }>({
    mutationFn: async ({ itemId }) => {
      const res = await api.post<JoinResponse>(
        `/g/${encodeURIComponent(garageSlug)}/items/${encodeURIComponent(itemId)}/waitlist`,
        {},
        { idempotencyKey: newIdempotencyKey() },
      );
      return res.entry;
    },
    onMutate: async ({ itemId }) => {
      const key = toolDetailQueryKey(garageSlug, itemId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ToolDetailResponse>(key);
      if (previous) {
        qc.setQueryData<ToolDetailResponse>(key, {
          ...previous,
          waitlist_size: previous.waitlist_size + 1,
          my_waitlist_entry: {
            id: "optimistic",
            position: previous.waitlist_size + 1,
          },
        });
      }
      return previous ? { previous } : {};
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(toolDetailQueryKey(garageSlug, vars.itemId), ctx.previous);
      }
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: toolDetailQueryKey(garageSlug, vars.itemId) });
    },
  });
}

export function useLeaveWaitlist(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { entryId: string; itemId: string },
    { previous?: ToolDetailResponse }
  >({
    mutationFn: async ({ entryId }) => {
      await api.delete<void>(
        `/g/${encodeURIComponent(garageSlug)}/waitlist/${encodeURIComponent(entryId)}`,
      );
    },
    onMutate: async ({ itemId }) => {
      const key = toolDetailQueryKey(garageSlug, itemId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ToolDetailResponse>(key);
      if (previous) {
        qc.setQueryData<ToolDetailResponse>(key, {
          ...previous,
          waitlist_size: Math.max(0, previous.waitlist_size - 1),
          my_waitlist_entry: null,
        });
      }
      return previous ? { previous } : {};
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(toolDetailQueryKey(garageSlug, vars.itemId), ctx.previous);
      }
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: toolDetailQueryKey(garageSlug, vars.itemId) });
    },
  });
}
