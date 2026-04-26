import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { DataExportButton } from "../DataExportButton";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function withQuery(children: ReactNode): JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("DataExportButton", () => {
  it("posts once, shows confirmation, and disables further presses", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: "queued" }));
    const user = userEvent.setup();
    render(withQuery(<DataExportButton />));

    const btn = screen.getByRole("button", { name: /download my data/i });
    await user.click(btn);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("/me/data-export");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("POST");

    expect(await screen.findByText(/sent to your phone/i)).toBeInTheDocument();

    // Button is now disabled and renamed; clicking should be a no-op.
    const after = screen.getByRole("button", { name: /sent/i });
    expect(after).toBeDisabled();
    await user.click(after);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
