import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { AuditLogList } from "../Activity/AuditLogList";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function wrap(child: ReactNode): JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{child}</QueryClientProvider>;
}

describe("AuditLogList", () => {
  it("renders entries from the first page", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        entries: [
          {
            id: "01H",
            garage_id: "demo-garage",
            date: "2026-04-26",
            actor_phone: "+15555550000",
            action_type: "member.tier_changed",
            entity_type: "member",
            entity_id: "+15555550100",
            before_snapshot: { tier: "friend" },
            after_snapshot: { tier: "family" },
            http_method: "PATCH",
            path: "/v1/g/demo-garage/admin/members/+15555550100",
            created_at: "2026-04-26T10:00:00Z",
          },
        ],
      }),
    );

    render(wrap(<AuditLogList />));
    await waitFor(() => expect(screen.getByText("member.tier_changed")).toBeInTheDocument());
  });

  it("re-issues the request with action_type filter when typed", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ entries: [] }));

    const user = userEvent.setup();
    render(wrap(<AuditLogList />));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    await user.type(screen.getByTestId("audit-filter-action"), "member.tier_changed");
    await waitFor(() => {
      const lastCall = fetchMock.mock.calls.at(-1);
      expect(lastCall?.[0]).toContain("action_type=member.tier_changed");
    });
  });
});
