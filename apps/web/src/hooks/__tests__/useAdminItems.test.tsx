import type { JSX, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  adminItemsKey,
  useAdminItems,
  useBulkImportItems,
  useCreateAdminItem,
  useCreateInstance,
  useRetireAdminItem,
  useUpdateAdminItem,
} from "../useAdminItems";

const GARAGE = "demo garage";
let calls: Array<{ url: string; init: RequestInit }>;
let replies: unknown[];

beforeEach(() => {
  calls = [];
  replies = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = replies.length > 1 ? replies.shift() : replies[0];
      return Promise.resolve(
        new Response(JSON.stringify(body ?? {}), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper, spy };
}

const header = (i: number, name: string) =>
  (calls[i]?.init.headers as Record<string, string>)[name];
const body = (i: number) => JSON.parse(String(calls[i]?.init.body)) as unknown;

describe("adminItemsKey", () => {
  it("includes the garage and filters", () => {
    expect(adminItemsKey("g", { q: "saw" })).toEqual(["admin", "items", "g", { q: "saw" }]);
  });
});

describe("useAdminItems", () => {
  it("fetches without a query string when no filters are set", async () => {
    replies = [{ items: [] }];
    const { wrapper } = setup();
    const { result } = renderHook(() => useAdminItems(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0]?.url).toBe("/v1/g/demo-garage/items");
    expect(result.current.hasNextPage).toBe(false);
  });

  it("encodes every filter and follows the cursor to the next page", async () => {
    replies = [{ items: [{ id: "i1" }], next_cursor: "c/2" }, { items: [{ id: "i2" }] }];
    const { wrapper } = setup();
    const { result } = renderHook(
      () =>
        useAdminItems(
          { q: "drill bit", category: "power", available_now: true, sort: "popular" },
          GARAGE,
        ),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const first = new URL(calls[0]!.url, "http://localhost");
    expect(first.pathname).toBe("/v1/g/demo%20garage/items");
    expect(Object.fromEntries(first.searchParams)).toEqual({
      q: "drill bit",
      category: "power",
      available_now: "true",
      sort: "popular",
    });
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages.length).toBe(2));
    const second = new URL(calls[1]!.url, "http://localhost");
    expect(second.searchParams.get("cursor")).toBe("c/2");
    expect(result.current.data?.pages[1]?.items[0]?.id).toBe("i2");
  });

  it("drops a false available_now filter from the query string", async () => {
    replies = [{ items: [] }];
    const { wrapper } = setup();
    const { result } = renderHook(() => useAdminItems({ available_now: false }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0]?.url).toBe("/v1/g/demo-garage/items");
  });
});

describe("item mutations", () => {
  it("useUpdateAdminItem PATCHes the encoded item and invalidates admin + pegboard lists", async () => {
    replies = [{ item: { id: "item/1", name: "Saw" } }];
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useUpdateAdminItem(GARAGE), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ itemId: "item/1", body: { name: "Saw" } });
    });
    expect(calls[0]?.url).toBe("/v1/g/demo%20garage/items/item%2F1");
    expect(calls[0]?.init.method).toBe("PATCH");
    expect(body(0)).toEqual({ name: "Saw" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin", "items", GARAGE] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["garage-items", GARAGE] });
  });

  it("useCreateAdminItem POSTs with an idempotency key", async () => {
    replies = [{ item: { id: "new" } }];
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useCreateAdminItem(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ name: "Ladder", category: "hand" });
    });
    expect(calls[0]?.url).toBe("/v1/g/demo-garage/items");
    expect(calls[0]?.init.method).toBe("POST");
    expect(body(0)).toEqual({ name: "Ladder", category: "hand" });
    expect(header(0, "Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["garage-items", "demo-garage"] });
  });

  it("useRetireAdminItem POSTs to the retire route", async () => {
    replies = [{ item: { id: "i1" } }];
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useRetireAdminItem(GARAGE), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ itemId: "i1" });
    });
    expect(calls[0]?.url).toBe("/v1/g/demo%20garage/items/i1/retire");
    expect(calls[0]?.init.method).toBe("POST");
    expect(body(0)).toEqual({});
    expect(header(0, "Idempotency-Key")).toBeTruthy();
    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin", "items", GARAGE] });
  });

  it("useCreateInstance sends notes only when provided", async () => {
    replies = [{ instance: { id: "inst" } }];
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useCreateInstance(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ itemId: "i1", label: "A", quality_tier: "good" });
      await result.current.mutateAsync({
        itemId: "i1",
        label: "B",
        quality_tier: "worn",
        notes: "chipped blade",
      });
    });
    expect(calls[0]?.url).toBe("/v1/g/demo-garage/items/i1/instances");
    expect(body(0)).toEqual({ label: "A", quality_tier: "good" });
    expect(body(1)).toEqual({ label: "B", quality_tier: "worn", notes: "chipped blade" });
    expect(header(0, "Idempotency-Key")).not.toBe(header(1, "Idempotency-Key"));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin", "items", "demo-garage"] });
  });

  it("useBulkImportItems posts the rows and returns the per-row result", async () => {
    const res = { total: 1, created: 1, errors: 0, results: [{ index: 0, status: "ok" }] };
    replies = [res];
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useBulkImportItems(GARAGE), { wrapper });
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync({ rows: [{ name: "Rake" }] });
    });
    expect(out).toEqual(res);
    expect(calls[0]?.url).toBe("/v1/g/demo%20garage/admin/items/bulk");
    expect(body(0)).toEqual({ rows: [{ name: "Rake" }] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin", "items", GARAGE] });
  });

  it("does not invalidate when the API rejects the update", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: "forbidden", message: "Nope" } }), {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useUpdateAdminItem(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ itemId: "i1", body: { name: "x" } }),
      ).rejects.toMatchObject({ code: "forbidden", status: 403 });
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
