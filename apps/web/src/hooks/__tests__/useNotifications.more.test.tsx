import type { JSX, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const syncAppBadge = vi.fn((_n: number) => Promise.resolve());
vi.mock("../../lib/pushSubscription", () => ({
  syncAppBadge: (n: number) => syncAppBadge(n),
}));

import {
  NOTIFICATIONS_QUERY_KEY,
  type NotificationPage,
  useMarkAllRead,
  useMarkRead,
  useUnreadCount,
} from "../useNotifications";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  syncAppBadge.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function note(id: string, read_at?: string) {
  return {
    id,
    user_phone: "+15555550100",
    type: "loan_due",
    payload: {},
    channel: "inapp",
    sent_at: "2026-04-26T12:00:00Z",
    ...(read_at ? { read_at } : {}),
  };
}

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const spy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper, spy };
}

type Inbox = { pages: NotificationPage[]; pageParams: unknown[] };

function seed(client: QueryClient): void {
  client.setQueryData<Inbox>(NOTIFICATIONS_QUERY_KEY, {
    pages: [{ items: [note("n1"), note("n/2"), note("n3", "2026-04-01T00:00:00Z")] }],
    pageParams: [undefined],
  } as unknown as Inbox);
}

const items = (client: QueryClient) =>
  client.getQueryData<Inbox>(NOTIFICATIONS_QUERY_KEY)?.pages[0]?.items ?? [];

describe("useMarkRead", () => {
  it("marks the notification read optimistically and POSTs to its encoded read route", async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    const { client, wrapper, spy } = setup();
    seed(client);
    const { result } = renderHook(() => useMarkRead(), { wrapper });

    act(() => {
      result.current.mutate({ id: "n/2" });
    });
    await waitFor(() => expect(items(client)[1]?.read_at).toBeTruthy());
    expect(items(client)[0]?.read_at).toBeUndefined();
    // Already-read notifications keep their original timestamp.
    expect(items(client)[2]?.read_at).toBe("2026-04-01T00:00:00Z");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/me/notifications/n%2F2/read");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("POST");

    resolve(jsonResponse({ notification: note("n/2", "2026-04-27T00:00:00Z") }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe("n/2");
    expect(spy).toHaveBeenCalledWith({ queryKey: NOTIFICATIONS_QUERY_KEY });
  });

  it("rolls the optimistic change back when the request fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: "boom", message: "x" } }, 500));
    const { client, wrapper } = setup();
    seed(client);
    vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
    const { result } = renderHook(() => useMarkRead(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({ id: "n1" })).rejects.toMatchObject({
        status: 500,
      });
    });
    expect(items(client)[0]?.read_at).toBeUndefined();
  });

  it("still posts when the inbox has not been loaded", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ notification: note("n1", "2026-04-27") }));
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useMarkRead(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "n1" });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(NOTIFICATIONS_QUERY_KEY)).toBeUndefined();
  });

  it("leaves the cache alone on error if there was nothing to snapshot", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 500));
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useMarkRead(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ id: "n1" })).rejects.toBeTruthy();
    });
    expect(client.getQueryData(NOTIFICATIONS_QUERY_KEY)).toBeUndefined();
  });
});

describe("useMarkAllRead", () => {
  it("POSTs read-all, refreshes the inbox and clears the app badge", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ marked_read: 3 }));
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useMarkAllRead(), { wrapper });
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync();
    });
    expect(out).toEqual({ marked_read: 3 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/me/notifications/read-all");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("POST");
    expect(spy).toHaveBeenCalledWith({ queryKey: NOTIFICATIONS_QUERY_KEY });
    expect(syncAppBadge).toHaveBeenCalledWith(0);
  });

  it("does not clear the badge when the request fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503));
    const { wrapper } = setup();
    const { result } = renderHook(() => useMarkAllRead(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toBeTruthy();
    });
    expect(syncAppBadge).not.toHaveBeenCalled();
  });
});

describe("useUnreadCount", () => {
  it("counts unread items from the unread endpoint and syncs the badge", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [note("a"), note("b")] }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useUnreadCount(), { wrapper });
    expect(result.current.count).toBe(0);
    await waitFor(() => expect(result.current.count).toBe(2));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/me/notifications?unread=true");
    expect(syncAppBadge).toHaveBeenLastCalledWith(2);
  });

  it("reports zero when the request fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 401));
    const { wrapper } = setup();
    const { result } = renderHook(() => useUnreadCount(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.count).toBe(0);
    expect(syncAppBadge).toHaveBeenCalledWith(0);
  });
});
