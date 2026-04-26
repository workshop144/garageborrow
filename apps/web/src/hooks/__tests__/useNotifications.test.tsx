import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";

import { useNotifications } from "../useNotifications";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrapper(): {
  Provider: ({ children }: { children: ReactNode }) => JSX.Element;
  client: QueryClient;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    client,
    Provider: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("useNotifications pagination", () => {
  it("fetches the first page and a second page using the cursor", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "n1",
              user_phone: "+15555550100",
              type: "loan_due",
              payload: {},
              channel: "inapp",
              sent_at: "2026-04-26T12:00:00Z",
            },
          ],
          next_cursor: "cursor-2",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "n2",
              user_phone: "+15555550100",
              type: "loan_due",
              payload: {},
              channel: "inapp",
              sent_at: "2026-04-25T12:00:00Z",
            },
          ],
        }),
      );

    const { Provider } = wrapper();
    const { result } = renderHook(() => useNotifications(), { wrapper: Provider });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0]?.items[0]?.id).toBe("n1");
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.data?.pages.length).toBe(2));
    expect(result.current.data?.pages[1]?.items[0]?.id).toBe("n2");
    expect(result.current.hasNextPage).toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallUrl = fetchMock.mock.calls[1]?.[0] as string;
    expect(secondCallUrl).toContain("cursor=cursor-2");
  });
});
