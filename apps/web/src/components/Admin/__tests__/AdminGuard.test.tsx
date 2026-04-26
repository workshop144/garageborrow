import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { AdminGuard } from "../AdminGuard";

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
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/" element={<div>HOME</div>} />
          <Route path="/admin" element={child} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("AdminGuard", () => {
  it("renders children when /me reports owner tier", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        user: { phone: "+15555550000", display_name: "Owner" },
        tier: "owner",
        owned_garages: ["demo-garage"],
        celebration_pending: false,
      }),
    );

    render(
      wrap(
        <AdminGuard>
          <div>OWNER ADMIN</div>
        </AdminGuard>,
      ),
    );
    await waitFor(() => expect(screen.getByText("OWNER ADMIN")).toBeInTheDocument());
  });

  it("redirects non-owners to /", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        user: { phone: "+15555550100", display_name: "Family" },
        tier: "family",
        owned_garages: [],
        celebration_pending: false,
      }),
    );

    render(
      wrap(
        <AdminGuard>
          <div>OWNER ADMIN</div>
        </AdminGuard>,
      ),
    );
    await waitFor(() => expect(screen.getByText("HOME")).toBeInTheDocument());
    expect(screen.queryByText("OWNER ADMIN")).not.toBeInTheDocument();
  });
});
