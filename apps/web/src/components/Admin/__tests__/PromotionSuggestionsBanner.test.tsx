import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { PromotionSuggestionsBanner } from "../Members/PromotionSuggestionsBanner";

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

describe("PromotionSuggestionsBanner", () => {
  it("renders suggestions when threshold is met", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        threshold: 3,
        suggestions: [
          {
            user_phone: "+15551112222",
            current_tier: "howdy",
            suggested_tier: "friend",
            returns_on_time: 5,
          },
        ],
      }),
    );

    render(wrap(<PromotionSuggestionsBanner />));
    await waitFor(() => expect(screen.getByTestId("promotion-suggestions")).toBeInTheDocument());
    expect(screen.getByTestId("promotion-+15551112222")).toBeInTheDocument();
    expect(screen.getByText(/5 on-time returns/i)).toBeInTheDocument();
  });

  it("renders nothing when there are no suggestions", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ threshold: 3, suggestions: [] }));

    const { container } = render(wrap(<PromotionSuggestionsBanner />));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="promotion-suggestions"]')).toBeNull();
  });
});
