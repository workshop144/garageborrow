import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import * as React from "react";

import { ComingSoonCard } from "../ComingSoonCard";
import Pegboard from "../../../pages/Pegboard";

vi.mock("framer-motion", async () => {
  const ReactInner = await import("react");
  return {
    motion: new Proxy(
      {},
      {
        get:
          () =>
          ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) =>
            ReactInner.createElement("div", rest, children),
      },
    ),
    MotionConfig: ({ children }: { children: React.ReactNode }) =>
      ReactInner.createElement(ReactInner.Fragment, null, children),
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      ReactInner.createElement(ReactInner.Fragment, null, children),
  };
});

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
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{child}</MemoryRouter>
    </QueryClientProvider>
  );
}

const baseUser = {
  phone: "+15555550100",
  display_name: "Family User",
  visibility: "visible",
  garages_member_of: ["demo-garage"],
  notification_prefs: {
    sms_enabled: true,
    push_enabled: true,
    reminders: true,
    waitlist_updates: true,
    new_tools: true,
    promotion_celebrations: true,
    ai_ready_notify: false,
    quiet_hours_start: "21:00",
    quiet_hours_end: "08:00",
  },
  created_at: "2026-01-01T00:00:00Z",
  last_seen_at: "2026-04-26T15:00:00Z",
};

describe("ComingSoonCard", () => {
  it("PATCHes /me when the notify toggle is clicked", async () => {
    // /me: initial GET → PATCH → invalidation triggers refetch. Use a router
    // to dispatch by method so tests don't depend on call ordering.
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "PATCH") {
        return jsonResponse({
          user: {
            ...baseUser,
            notification_prefs: { ...baseUser.notification_prefs, ai_ready_notify: true },
          },
        });
      }
      if (url.endsWith("/me")) {
        return jsonResponse({ user: baseUser });
      }
      return jsonResponse({}, 404);
    });

    const user = userEvent.setup();
    render(wrap(<ComingSoonCard />));

    const toggle = await screen.findByTestId("ai-notify-toggle");
    expect(toggle).toHaveTextContent(/Get notified/i);
    await user.click(toggle);

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patchCall).toBeTruthy();
      const init = patchCall![1] as RequestInit;
      expect(JSON.parse(init.body as string)).toEqual({
        notification_prefs: { ai_ready_notify: true },
      });
    });
  });
});

describe("Pegboard AI gating", () => {
  function mockPegboardResponses(opts: {
    tier: "howdy" | "friend" | "family" | "owner";
    aiEnabled: boolean;
  }): void {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/me")) {
        return jsonResponse({
          user: baseUser,
          tier: opts.tier,
          owned_garages: opts.tier === "owner" ? ["demo-garage"] : [],
          memberships: [],
          celebration_pending: false,
        });
      }
      if (url.includes("/g/demo-garage/items")) {
        return jsonResponse({ items: [] });
      }
      if (url.match(/\/g\/demo-garage$/)) {
        return jsonResponse({
          garage: {
            id: "demo-garage",
            name: "Demo Garage",
            city_display: "Sample Town, ST",
            status: "open",
            payforward_orgs: [],
            tier_labels: { howdy: "Howdy", friend: "Friend", family: "Family" },
            ai_enabled: opts.aiEnabled,
            vouching_required: false,
          },
        });
      }
      return jsonResponse({}, 404);
    });
  }

  it("hides the card for non-Family members", async () => {
    mockPegboardResponses({ tier: "friend", aiEnabled: false });
    render(wrap(<Pegboard />));
    // Wait for the items query to resolve, then assert the card is absent.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId("ai-coming-soon")).not.toBeInTheDocument();
  });

  it("hides the card when ai_enabled is true (real AI is live)", async () => {
    mockPegboardResponses({ tier: "family", aiEnabled: true });
    render(wrap(<Pegboard />));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId("ai-coming-soon")).not.toBeInTheDocument();
  });

  it("shows the card to Family-tier members when ai_enabled is false", async () => {
    mockPegboardResponses({ tier: "family", aiEnabled: false });
    render(wrap(<Pegboard />));
    await waitFor(() => expect(screen.getByTestId("ai-coming-soon")).toBeInTheDocument());
  });
});
