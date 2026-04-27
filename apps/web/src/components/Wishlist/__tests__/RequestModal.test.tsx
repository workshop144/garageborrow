import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { RequestModal } from "../RequestModal";

vi.mock("../../../lib/uploadPhoto", () => ({
  uploadPhoto: vi.fn().mockResolvedValue({ key: "wishlist/test/photo.jpg" }),
}));

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

describe("RequestModal", () => {
  it("blocks submit until the name is entered", async () => {
    const user = userEvent.setup();
    render(wrap(<RequestModal open onClose={() => {}} />));
    const next = screen.getByTestId("wishlist-next");
    expect(next).toBeDisabled();
    await user.type(screen.getByTestId("wishlist-name-input"), "Log splitter");
    expect(next).toBeEnabled();
  });

  it("walks through every step and POSTs with an Idempotency-Key", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        request: {
          id: "wish_x",
          garage_id: "demo-garage",
          requester_phone: "+15555550100",
          item_name: "Log splitter",
          status: "open",
          vote_count: 1,
          my_vote: true,
          created_at: "2026-04-26T15:00:00Z",
          updated_at: "2026-04-26T15:00:00Z",
        },
      }),
    );
    render(wrap(<RequestModal open onClose={() => {}} />));
    await user.type(screen.getByTestId("wishlist-name-input"), "Log splitter");
    // Click next 5 times to reach confirm.
    for (let i = 0; i < 5; i += 1) {
      await user.click(screen.getByTestId("wishlist-next"));
    }
    await user.click(screen.getByTestId("wishlist-submit"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBeTruthy();
    expect(JSON.parse(init.body as string)).toMatchObject({ item_name: "Log splitter" });
  });
});
