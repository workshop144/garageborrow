import type { JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import Wishlist from "../Wishlist";
import WishlistDetail from "../WishlistDetail";

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

function wrap(child: ReactNode, initialEntries: string[] = ["/wishlist"]): JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>{child}</MemoryRouter>
    </QueryClientProvider>
  );
}

const GARAGE_RESPONSE = {
  garage: {
    id: "demo-garage",
    name: "Demo Garage",
    city_display: "Sample Town, ST",
    status: "open",
    payforward_orgs: [],
    tier_labels: { howdy: "Howdy", friend: "Friend", family: "Family" },
    ai_enabled: false,
    vouching_required: false,
    wishlist_enabled: true,
    wishlist_popular_threshold: 5,
  },
};

const SAMPLE_REQUESTS = {
  items: [
    {
      id: "wish_a",
      garage_id: "demo-garage",
      requester_phone: "+15555550100",
      item_name: "Pressure washer",
      status: "open",
      vote_count: 3,
      my_vote: false,
      created_at: "2026-04-25T12:00:00Z",
      updated_at: "2026-04-25T12:00:00Z",
    },
    {
      id: "wish_b",
      garage_id: "demo-garage",
      requester_phone: "+15555550200",
      item_name: "Log splitter",
      status: "open",
      vote_count: 1,
      my_vote: true,
      created_at: "2026-04-24T12:00:00Z",
      updated_at: "2026-04-24T12:00:00Z",
    },
  ],
};

describe("Wishlist list page", () => {
  it("renders rows and shows filled state when my_vote=true", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/wishlist?")) return Promise.resolve(jsonResponse(SAMPLE_REQUESTS));
      if (url.endsWith("/g/demo-garage")) return Promise.resolve(jsonResponse(GARAGE_RESPONSE));
      return Promise.resolve(jsonResponse({}));
    });
    render(wrap(<Wishlist />));
    await waitFor(() => expect(screen.getByText("Pressure washer")).toBeInTheDocument());
    expect(screen.getByText("Log splitter")).toBeInTheDocument();
    const voteB = screen.getByTestId("wishlist-vote-wish_b");
    expect(voteB.getAttribute("aria-pressed")).toBe("true");
    const voteA = screen.getByTestId("wishlist-vote-wish_a");
    expect(voteA.getAttribute("aria-pressed")).toBe("false");
  });

  it("optimistically toggles the vote button", async () => {
    const user = userEvent.setup();
    let listCalls = 0;
    const updatedList = {
      items: [
        { ...SAMPLE_REQUESTS.items[0], my_vote: true, vote_count: 4 },
        SAMPLE_REQUESTS.items[1],
      ],
    };
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/g/demo-garage")) return Promise.resolve(jsonResponse(GARAGE_RESPONSE));
      if (url.includes("/wishlist?")) {
        listCalls += 1;
        // First call seeds the list. Any refetch (from invalidation after the
        // vote completes) returns the updated data so the post-mutation state
        // matches the optimistic state.
        return Promise.resolve(jsonResponse(listCalls === 1 ? SAMPLE_REQUESTS : updatedList));
      }
      if (url.includes("/wishlist/wish_a/vote") && init?.method === "POST") {
        return Promise.resolve(
          jsonResponse({
            request: { ...SAMPLE_REQUESTS.items[0], my_vote: true, vote_count: 4 },
            vote_count: 4,
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    render(wrap(<Wishlist />));
    await waitFor(() => expect(screen.getByText("Pressure washer")).toBeInTheDocument());
    const voteA = screen.getByTestId("wishlist-vote-wish_a");
    await user.click(voteA);
    await waitFor(() => expect(voteA.getAttribute("aria-pressed")).toBe("true"));
  });

  it("redirects when wishlist is disabled", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith("/g/demo-garage")) {
        return Promise.resolve(
          jsonResponse({
            garage: { ...GARAGE_RESPONSE.garage, wishlist_enabled: false },
          }),
        );
      }
      if (url.includes("/wishlist?")) return Promise.resolve(jsonResponse(SAMPLE_REQUESTS));
      return Promise.resolve(jsonResponse({}));
    });
    render(wrap(<Wishlist />));
    // The redirect leaves the page empty of the wishlist heading.
    await waitFor(() => expect(screen.queryByText("The Wishlist")).not.toBeInTheDocument());
  });
});

describe("Wishlist photos and hidden members", () => {
  it("renders only upload keys through photoUrl, never a dot-segment key", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith("/g/demo-garage")) return Promise.resolve(jsonResponse(GARAGE_RESPONSE));
      if (url.includes("/wishlist?")) {
        return Promise.resolve(
          jsonResponse({
            items: [
              { ...SAMPLE_REQUESTS.items[0], photo_url: "uploads/../../v1/g/x/admin" },
              { ...SAMPLE_REQUESTS.items[1], photo_url: "uploads/wishlist/abc.jpg" },
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    const { container } = render(wrap(<Wishlist />));
    await waitFor(() => expect(screen.getByText("Pressure washer")).toBeInTheDocument());
    const srcs = Array.from(container.querySelectorAll("img")).map((i) => i.getAttribute("src"));
    expect(srcs).toEqual([expect.stringMatching(/\/img\/uploads\/wishlist\/abc\.jpg$/)]);
    expect(container.innerHTML).not.toContain("..");
  });

  it("shows 'A neighbor' for a hidden requester and voter, with no phone digits", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/wishlist/wish_a")) {
        return Promise.resolve(
          jsonResponse({
            request: {
              ...SAMPLE_REQUESTS.items[0],
              requester_phone: null,
              photo_url: "uploads/../x",
            },
            voters: [
              { phone: null, display_name: null },
              { phone: "***0200", display_name: "Fri" },
            ],
            requester_display_name: null,
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    const { container } = render(
      wrap(
        <Routes>
          <Route path="/wishlist/:id" element={<WishlistDetail />} />
        </Routes>,
        ["/wishlist/wish_a"],
      ),
    );
    await waitFor(() => expect(screen.getByText("Pressure washer")).toBeInTheDocument());
    expect(screen.getByText(/From A neighbor/)).toBeInTheDocument();
    expect(screen.getByText("A neighbor")).toBeInTheDocument();
    expect(screen.getByText("Fri")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Member \d/);
    expect(container.querySelector("img")).toBeNull();
  });

  it("falls back to the last 4 digits when the owner gets a number but no name", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/wishlist/wish_a")) {
        return Promise.resolve(
          jsonResponse({
            request: { ...SAMPLE_REQUESTS.items[0], requester_phone: "+15555550100" },
            voters: [{ phone: "+15555550300", display_name: null }],
            requester_display_name: null,
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    render(
      wrap(
        <Routes>
          <Route path="/wishlist/:id" element={<WishlistDetail />} />
        </Routes>,
        ["/wishlist/wish_a"],
      ),
    );
    await waitFor(() => expect(screen.getByText("Pressure washer")).toBeInTheDocument());
    expect(screen.getByText(/From Member 0100/)).toBeInTheDocument();
    expect(screen.getByText("Member 0300")).toBeInTheDocument();
  });
});
