import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Notification } from "@garageborrow/shared";

import { api } from "../lib/api";

export type NotificationPage = {
  items: Notification[];
  next_cursor?: string;
};

export const NOTIFICATIONS_QUERY_KEY = ["notifications", "inbox"] as const;

export function useNotifications() {
  return useInfiniteQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const qs = pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : "";
      return api.get<NotificationPage>(`/me/notifications${qs}`, { signal });
    },
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 15_000,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation<Notification, Error, { id: string }, { snapshot?: NotificationPage[] }>({
    mutationFn: async ({ id }) => {
      const res = await api.post<{ notification: Notification }>(
        `/me/notifications/${encodeURIComponent(id)}/read`,
      );
      return res.notification;
    },
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      const data = qc.getQueryData<{ pages: NotificationPage[]; pageParams: unknown[] }>(
        NOTIFICATIONS_QUERY_KEY,
      );
      if (!data) return {};
      const ts = new Date().toISOString();
      qc.setQueryData(NOTIFICATIONS_QUERY_KEY, {
        ...data,
        pages: data.pages.map((p) => ({
          ...p,
          items: p.items.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: ts } : n)),
        })),
      });
      return { snapshot: data.pages };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) {
        const data = qc.getQueryData<{ pages: NotificationPage[]; pageParams: unknown[] }>(
          NOTIFICATIONS_QUERY_KEY,
        );
        if (data) {
          qc.setQueryData(NOTIFICATIONS_QUERY_KEY, { ...data, pages: ctx.snapshot });
        }
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation<{ marked_read: number }, Error, void>({
    mutationFn: () => api.post<{ marked_read: number }>("/me/notifications/read-all"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
    },
  });
}
