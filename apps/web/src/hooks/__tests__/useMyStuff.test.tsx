import type { JSX, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  myStuffQueryKey,
  useCancelReservation,
  useLeaveWaitlistFromMyStuff,
  useMyStuff,
  useReturnLoan,
} from "../useMyStuff";

const GARAGE = "demo garage";
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, status = 200, statusText = ""): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  });
}

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const spy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, spy };
}

const STUFF = {
  loans: [{ loan: { id: "loan-1" }, item: { id: "i1", name: "Drill" } }],
  reservations: [],
  waitlist: [],
  stats: { borrows_total: 4, returns_on_time: 3, borrows_active: 1 },
};

describe("useMyStuff", () => {
  it("loads My Stuff for the encoded garage", async () => {
    fetchMock.mockResolvedValue(jsonResponse(STUFF));
    const { wrapper } = setup();
    const { result } = renderHook(() => useMyStuff(GARAGE), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/me/stuff?garage=demo%20garage");
    expect(result.current.data?.stats.borrows_total).toBe(4);
  });

  it("treats a 404 whose message names the status as an empty My Stuff", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: "x", message: "HTTP 404" } }, 404));
    const { wrapper } = setup();
    const { result } = renderHook(() => useMyStuff(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      loans: [],
      reservations: [],
      waitlist: [],
      stats: { borrows_total: 0, returns_on_time: 0, borrows_active: 0 },
    });
  });

  it("surfaces other errors", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: "forbidden", message: "No" } }, 403));
    const { wrapper } = setup();
    const { result } = renderHook(() => useMyStuff(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ code: "forbidden", status: 403 });
  });
});

describe("My Stuff mutations", () => {
  it("useReturnLoan POSTs to the loan's return route and returns the loan", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ loan: { id: "loan/1", status: "returned" } }));
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useReturnLoan(GARAGE), { wrapper });
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync({ loanId: "loan/1" });
    });
    expect(out).toEqual({ id: "loan/1", status: "returned" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/v1/g/demo%20garage/loans/loan%2F1/return");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(spy).toHaveBeenCalledWith({ queryKey: myStuffQueryKey(GARAGE) });
  });

  it("useReturnLoan refreshes My Stuff even when the return fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: "conflict", message: "x" } }, 409));
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useReturnLoan(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ loanId: "l" })).rejects.toMatchObject({
        status: 409,
      });
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: myStuffQueryKey("demo-garage") });
  });

  it("useCancelReservation DELETEs the reservation", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useCancelReservation(GARAGE), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ reservationId: "res 1" });
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/v1/g/demo%20garage/reservations/res%201");
    expect(init.method).toBe("DELETE");
    expect(spy).toHaveBeenCalledWith({ queryKey: myStuffQueryKey(GARAGE) });
  });

  it("useLeaveWaitlistFromMyStuff DELETEs the waitlist entry", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useLeaveWaitlistFromMyStuff(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ entryId: "w1" });
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/v1/g/demo-garage/waitlist/w1");
    expect(init.method).toBe("DELETE");
    expect(spy).toHaveBeenCalledWith({ queryKey: myStuffQueryKey("demo-garage") });
  });
});
