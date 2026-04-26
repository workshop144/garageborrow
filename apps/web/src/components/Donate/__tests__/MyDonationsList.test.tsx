import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { MyDonationsList } from "../MyDonationsList";

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

const baseDonation = {
  garage_id: "demo-garage",
  donor_phone: "+15555550100",
  description: "",
  photo_keys: [],
  condition: "good" as const,
  created_at: "2026-04-26T10:00:00Z",
};

describe("MyDonationsList", () => {
  it("renders the empty state when there are no donations", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ donations: [] }));
    render(wrap(<MyDonationsList />));
    await waitFor(() => expect(screen.getByTestId("my-donations-empty")).toBeInTheDocument());
  });

  it("shows status-aware copy for pending, accepted, and declined", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        donations: [
          { ...baseDonation, id: "d-1", item_name: "Old Saw", status: "pending" },
          {
            ...baseDonation,
            id: "d-2",
            item_name: "Drill",
            status: "accepted",
            resulting_item_id: "item-9",
          },
          {
            ...baseDonation,
            id: "d-3",
            item_name: "Sander",
            status: "declined",
            decline_reason: "duplicate",
          },
        ],
      }),
    );

    render(wrap(<MyDonationsList />));

    await waitFor(() => expect(screen.getByTestId("my-donations-list")).toBeInTheDocument());
    expect(screen.getByText(/Dad's looking at it/i)).toBeInTheDocument();
    expect(screen.getByText(/in the garage now/i)).toBeInTheDocument();
    expect(screen.getByText(/Dad passed on this one/i)).toBeInTheDocument();
    expect(screen.getByText(/Reason: duplicate/i)).toBeInTheDocument();
  });

  it("links accepted donations to the resulting item", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        donations: [
          {
            ...baseDonation,
            id: "d-1",
            item_name: "Drill",
            status: "accepted",
            resulting_item_id: "item-9",
          },
        ],
      }),
    );

    render(wrap(<MyDonationsList />));

    const link = await screen.findByTestId("my-donation-link-d-1");
    expect(link).toHaveAttribute("href", "/tool/item-9");
  });
});
