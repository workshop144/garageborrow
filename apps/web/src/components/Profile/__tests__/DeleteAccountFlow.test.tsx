import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { DeleteAccountFlow, daysUntilHardDelete } from "../DeleteAccountFlow";

const startSignInMock = vi.fn();
const confirmOtpMock = vi.fn();

vi.mock("../../../lib/auth/cognito", () => ({
  startSignIn: (...args: unknown[]) => startSignInMock(...args),
  confirmOtp: (...args: unknown[]) => confirmOtpMock(...args),
}));

vi.mock("../../../lib/auth/AuthContext", () => ({
  useAuth: () => ({ username: "+15555550100" }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  startSignInMock.mockReset();
  confirmOtpMock.mockReset();
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

describe("daysUntilHardDelete", () => {
  it("returns the number of days remaining until 30-day cutoff", () => {
    const now = new Date("2026-04-26T00:00:00Z");
    expect(daysUntilHardDelete("2026-04-26T00:00:00Z", now)).toBe(30);
    expect(daysUntilHardDelete("2026-04-20T00:00:00Z", now)).toBe(24);
    expect(daysUntilHardDelete("2026-03-26T00:00:00Z", now)).toBe(0);
  });
});

describe("DeleteAccountFlow", () => {
  it("requires OTP, then schedules deletion via the API", async () => {
    startSignInMock.mockResolvedValueOnce({ session: "challenge" });
    confirmOtpMock.mockResolvedValueOnce({});
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: "deletion_requested",
        scheduled_for_hard_delete_at: "2026-04-26T00:00:00Z",
      }),
    );

    const user = userEvent.setup();
    render(withQuery(<DeleteAccountFlow />));

    await user.click(screen.getByTestId("delete-account-start"));
    await user.click(screen.getByTestId("delete-confirm-start-otp"));

    await waitFor(() => expect(startSignInMock).toHaveBeenCalledWith("+15555550100"));

    const input = await screen.findByTestId("delete-otp-input");
    await user.type(input, "123456");
    await user.click(screen.getByTestId("delete-otp-submit"));

    await waitFor(() => expect(confirmOtpMock).toHaveBeenCalledWith("+15555550100", "123456"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/me/delete-request");
    expect((init as RequestInit).method).toBe("POST");

    expect(await screen.findByText(/scheduled for deletion/i)).toBeInTheDocument();
  });

  it("shows the scheduled banner when deletedAt is set, and offers cancel", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "deletion_cancelled" }));
    const user = userEvent.setup();
    render(withQuery(<DeleteAccountFlow deletedAt="2026-04-20T00:00:00Z" />));

    expect(screen.getByTestId("deletion-banner")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /cancelling|cancel deletion/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("/me/delete-request/cancel");
  });
});
