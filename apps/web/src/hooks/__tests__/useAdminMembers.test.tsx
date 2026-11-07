import type { JSX, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  adminInvitesKey,
  adminMembersKey,
  useAdminInvites,
  useAdminMembers,
  useCreateInvite,
  usePromotionSuggestions,
  useRevokeInvite,
  useUpdateMember,
} from "../useAdminMembers";

const GARAGE = "demo garage";
const PHONE = "+15555550100";
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
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

const call = (i: number) => fetchMock.mock.calls[i] as [string, RequestInit];

describe("useAdminMembers", () => {
  it("pages through members using the cursor", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ members: [{ user_phone: PHONE }], next_cursor: "c 2" }))
      .mockResolvedValueOnce(jsonResponse({ members: [{ user_phone: "+15555550200" }] }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useAdminMembers(GARAGE), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(call(0)[0]).toBe("/v1/g/demo%20garage/admin/members");
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages.length).toBe(2));
    expect(call(1)[0]).toBe("/v1/g/demo%20garage/admin/members?cursor=c%202");
    expect(result.current.hasNextPage).toBe(false);
  });

  it("surfaces a forbidden error", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: "forbidden", message: "No" } }, 403));
    const { wrapper } = setup();
    const { result } = renderHook(() => useAdminMembers(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(call(0)[0]).toBe("/v1/g/demo-garage/admin/members");
  });
});

describe("read queries", () => {
  it("usePromotionSuggestions loads suggestions and threshold", async () => {
    const body = {
      suggestions: [
        { user_phone: PHONE, current_tier: "howdy", suggested_tier: "friend", returns_on_time: 5 },
      ],
      threshold: 5,
    };
    fetchMock.mockResolvedValue(jsonResponse(body));
    const { wrapper } = setup();
    const { result } = renderHook(() => usePromotionSuggestions(GARAGE), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(call(0)[0]).toBe("/v1/g/demo%20garage/admin/promotion-suggestions");
    expect(result.current.data).toEqual(body);
  });

  it("useAdminInvites loads pending invites", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ invites: [{ phone: PHONE, tier: "friend" }] }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useAdminInvites(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(call(0)[0]).toBe("/v1/g/demo-garage/admin/invites");
    expect(result.current.data?.invites[0]?.phone).toBe(PHONE);
  });
});

describe("member mutations", () => {
  it("useUpdateMember PATCHes the encoded phone and refreshes members + suggestions", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ membership: { user_phone: PHONE, tier: "family" } }),
    );
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useUpdateMember(GARAGE), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ phone: PHONE, body: { tier: "family", notes: "ok" } });
    });
    const [url, init] = call(0);
    expect(url).toBe("/v1/g/demo%20garage/admin/members/%2B15555550100");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ tier: "family", notes: "ok" });
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(spy).toHaveBeenCalledWith({ queryKey: adminMembersKey(GARAGE) });
    expect(spy).toHaveBeenCalledWith({
      queryKey: ["admin", "promotion-suggestions", GARAGE],
    });
  });

  it("useUpdateMember does not refresh when the PATCH fails", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "bad_request", message: "x" } }, 400),
    );
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useUpdateMember(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ phone: PHONE, body: { tier: "friend" } }),
      ).rejects.toMatchObject({ code: "bad_request" });
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("useCreateInvite POSTs the phone and tier", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ invite: { phone: PHONE, tier: "howdy" } }, 201));
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useCreateInvite(GARAGE), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ phone: PHONE, tier: "howdy" });
    });
    const [url, init] = call(0);
    expect(url).toBe("/v1/g/demo%20garage/admin/invites");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ phone: PHONE, tier: "howdy" });
    expect(spy).toHaveBeenCalledWith({ queryKey: adminInvitesKey(GARAGE) });
  });

  it("useRevokeInvite DELETEs the encoded phone", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: "revoked" }));
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useRevokeInvite(), { wrapper });
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync(PHONE);
    });
    expect(out).toEqual({ status: "revoked" });
    const [url, init] = call(0);
    expect(url).toBe("/v1/g/demo-garage/admin/invites/%2B15555550100");
    expect(init.method).toBe("DELETE");
    expect(spy).toHaveBeenCalledWith({ queryKey: adminInvitesKey("demo-garage") });
  });
});
