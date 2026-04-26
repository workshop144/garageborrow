import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useJoinWaitlist } from "../useWaitlist";
import { toolDetailQueryKey } from "../useToolDetail";
import type { ToolDetailResponse } from "../useToolDetail";

const GARAGE = "demo-garage";
const ITEM_ID = "item-1";

function seedDetail(qc: QueryClient): ToolDetailResponse {
  const seed: ToolDetailResponse = {
    item: {
      id: ITEM_ID,
      garage_id: "g1",
      name: "Hand Drill",
      description: "",
      category: "tools",
      primary_photo_key: "drill.jpg",
      default_duration_days: 3,
      requires_approval: false,
      min_tier: "howdy",
      auto_approve_tier: "family",
      tags: [],
      status: "all_loaned",
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
      access: "instant",
      available_count: 0,
      total_count: 1,
      borrows_total: 0,
      borrows_last_30d: 0,
    },
    instances: [],
    status_pills: [],
    handling_notes: "",
    waitlist_size: 1,
    my_waitlist_entry: null,
  };
  qc.setQueryData(toolDetailQueryKey(GARAGE, ITEM_ID), seed);
  return seed;
}

function wrap(qc: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

describe("useJoinWaitlist optimistic UI", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("optimistically updates waitlist size and rolls back on failure", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const seed = seedDetail(qc);

    // Hold the fetch in a deferred state so the test can observe the
    // optimistic update before the mutation settles.
    let resolveFetch!: (value: Response) => void;
    const fetchPending = new Promise<Response>((r) => {
      resolveFetch = r;
    });
    vi.stubGlobal("fetch", vi.fn(() => fetchPending) as unknown as typeof fetch);

    const { result } = renderHook(() => useJoinWaitlist(GARAGE), { wrapper: wrap(qc) });

    act(() => {
      result.current.mutate({ itemId: ITEM_ID });
    });

    await waitFor(() => {
      const snapshot = qc.getQueryData<ToolDetailResponse>(toolDetailQueryKey(GARAGE, ITEM_ID));
      expect(snapshot?.waitlist_size).toBe(seed.waitlist_size + 1);
    });
    const optimistic = qc.getQueryData<ToolDetailResponse>(toolDetailQueryKey(GARAGE, ITEM_ID));
    expect(optimistic?.my_waitlist_entry?.position).toBe(seed.waitlist_size + 1);

    // Now let the fetch fail; onError must restore the previous snapshot.
    await act(async () => {
      resolveFetch({
        ok: false,
        status: 500,
        statusText: "Server error",
        text: async () => JSON.stringify({ error: { code: "internal", message: "boom" } }),
      } as unknown as Response);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const rolledBack = qc.getQueryData<ToolDetailResponse>(toolDetailQueryKey(GARAGE, ITEM_ID));
    expect(rolledBack?.waitlist_size).toBe(seed.waitlist_size);
    expect(rolledBack?.my_waitlist_entry).toBeNull();
  });
});
