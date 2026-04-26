import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import PayItForward from "../../../pages/PayItForward";

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

// AppShell calls /me for the bottom nav; the page calls /g/:slug for the org
// list. Route both via URL so test order doesn't matter.
function mockResponses(garageBody: { payforward_orgs: unknown[] } & Record<string, unknown>): void {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith("/v1/me") || url.endsWith("/me")) {
      return jsonResponse({
        user: {
          phone: "+15555550100",
          display_name: "U",
          visibility: "visible",
          garages_member_of: ["demo-garage"],
          notification_prefs: {},
          created_at: "2026-01-01T00:00:00Z",
          last_seen_at: "2026-04-26T15:00:00Z",
        },
        tier: "family",
        owned_garages: [],
        memberships: [],
        celebration_pending: false,
      });
    }
    if (url.match(/\/g\/demo-garage$/)) {
      return jsonResponse({
        garage: {
          id: "demo-garage",
          name: "Demo Garage",
          city_display: "Sample Town, ST",
          status: "open",
          tier_labels: { howdy: "Howdy", friend: "Friend", family: "Family" },
          ai_enabled: false,
          vouching_required: false,
          ...garageBody,
        },
      });
    }
    return jsonResponse({}, 404);
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

describe("PayItForward page", () => {
  it("shows the empty state when no orgs are configured", async () => {
    mockResponses({ payforward_orgs: [] });
    render(wrap(<PayItForward />));
    await waitFor(() => expect(screen.getByTestId("payforward-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("payforward-orgs")).not.toBeInTheDocument();
  });

  it("renders cards for configured nonprofits with rel=noopener noreferrer external links", async () => {
    mockResponses({
      payforward_intro_copy: "Custom intro copy.",
      payforward_orgs: [
        {
          name: "Example Community Foundation",
          description: "Local nonprofit.",
          url: "https://example.org/yes",
          display_order: 0,
        },
      ],
    });
    render(wrap(<PayItForward />));
    await waitFor(() =>
      expect(screen.getByTestId("nonprofit-Example Community Foundation")).toBeInTheDocument(),
    );

    expect(screen.getByTestId("payforward-intro")).toHaveTextContent("Custom intro copy.");
    const link = screen.getByTestId("nonprofit-link-Example Community Foundation");
    expect(link).toHaveAttribute("href", "https://example.org/yes");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
