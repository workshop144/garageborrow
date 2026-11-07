import type { JSX, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBorrow } from "../useBorrow";
import { useExtension } from "../useExtension";
import { toolDetailQueryKey } from "../useToolDetail";

const GARAGE = "demo garage"; // space: the slug must be URL-encoded
let calls: Array<{ url: string; init: RequestInit }>;
let reply: unknown;

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(
        new Response(JSON.stringify(reply), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper, spy };
}

const header = (i: number, name: string) =>
  (calls[i]?.init.headers as Record<string, string>)[name];

describe("useBorrow", () => {
  it("posts the borrow with liability acknowledged and a fresh idempotency key", async () => {
    reply = { loan: { id: "loan-1" } };
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useBorrow(GARAGE), { wrapper });
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync({
        itemId: "item-1",
        instanceId: "inst-1",
        durationDays: 3,
        liabilityCopyVersion: "v1",
        note: "for the deck",
      });
    });
    expect(out).toEqual({ kind: "loan", loan: { id: "loan-1" } });
    expect(calls[0]?.url).toBe("/v1/g/demo%20garage/loans");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      item_id: "item-1",
      instance_id: "inst-1",
      liability_acknowledged: true,
      liability_copy_version: "v1",
      duration_days: 3,
      note: "for the deck",
    });
    expect(header(0, "Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(spy).toHaveBeenCalledWith({ queryKey: toolDetailQueryKey(GARAGE, "item-1") });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["garage-items", GARAGE] });
  });

  it("reports an approval-required borrow as a reservation and new attempts get new keys", async () => {
    reply = { reservation: { id: "res-1" }, message: "Waiting on the owner" };
    const { wrapper } = setup();
    const { result } = renderHook(() => useBorrow(GARAGE), { wrapper });
    const input = { itemId: "item-1", durationDays: 2, liabilityCopyVersion: "v1" };
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync(input);
      await result.current.mutateAsync(input);
    });
    expect(out).toEqual({
      kind: "reservation",
      reservation: { id: "res-1" },
      message: "Waiting on the owner",
    });
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty("instance_id");
    expect(body).not.toHaveProperty("note");
    expect(header(0, "Idempotency-Key")).not.toBe(header(1, "Idempotency-Key"));
  });

  it("omits message when the API sends none", async () => {
    reply = { reservation: { id: "res-2" } };
    const { wrapper } = setup();
    const { result } = renderHook(() => useBorrow(GARAGE), { wrapper });
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync({
        itemId: "i",
        durationDays: 1,
        liabilityCopyVersion: "v1",
      });
    });
    expect(out).toEqual({ kind: "reservation", reservation: { id: "res-2" } });
  });
});

describe("useExtension", () => {
  it("posts to the loan's extend route and refreshes My Stuff", async () => {
    reply = { loan: { id: "loan/1", expected_return_at: "2026-04-10T00:00:00Z" } };
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useExtension(GARAGE), { wrapper });
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync({
        loanId: "loan/1",
        newReturnAtUtc: "2026-04-10T00:00:00Z",
      });
    });
    expect(out).toMatchObject({ id: "loan/1" });
    expect(calls[0]?.url).toBe("/v1/g/demo%20garage/loans/loan%2F1/extend");
    expect(header(0, "Idempotency-Key")).toBeTruthy();
    expect(spy).toHaveBeenCalledWith({ queryKey: ["my-stuff", GARAGE] });
  });
});
