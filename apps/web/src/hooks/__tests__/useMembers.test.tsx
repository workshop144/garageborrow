import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { useMembers } from "../useMembers";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("useMembers cursor pagination", () => {
  it("threads next_cursor between fetches", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          members: [
            { phone_last4: "0001", display_name: "Alice", joined_at: "2026-01-01T00:00:00Z" },
          ],
          next_cursor: "next-page",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          members: [
            { phone_last4: "0002", display_name: "Bob", joined_at: "2026-02-01T00:00:00Z" },
          ],
        }),
      );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useMembers("demo-garage"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.pages[0]?.members[0]?.display_name).toBe("Alice");

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.data?.pages.length).toBe(2));
    expect(result.current.data?.pages[1]?.members[0]?.display_name).toBe("Bob");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("cursor=next-page");
  });
});
