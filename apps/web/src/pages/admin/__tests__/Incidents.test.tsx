import type { JSX, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import Incidents from "../Incidents";

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let incidentsByStatus: Record<string, unknown[]>;
let patchStatus: number;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const INCIDENT = {
  id: "inc_1",
  garage_id: "demo-garage",
  item_id: "item_1",
  reporter_phone: "+15555550100",
  type: "damage",
  description: "Blade chipped on the miter saw",
  status: "open",
  created_at: "2026-04-25T12:00:00Z",
};

beforeEach(() => {
  calls = [];
  patchStatus = 200;
  incidentsByStatus = {
    open: [INCIDENT],
    resolved: [{ ...INCIDENT, id: "inc_2", status: "resolved", description: "Fixed already" }],
    closed: [],
    all: [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      const method = init.method ?? "GET";
      calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes("/admin/incidents") && method === "GET") {
        const status = new URL(url, "http://x").searchParams.get("status") ?? "all";
        return Promise.resolve(jsonResponse({ incidents: incidentsByStatus[status] ?? [] }));
      }
      if (url.includes("/admin/incidents/") && method === "PATCH") {
        return Promise.resolve(
          patchStatus === 200
            ? jsonResponse({ incident: { ...INCIDENT, status: "resolved" } })
            : jsonResponse({ error: { code: "bad", message: "nope" } }, patchStatus),
        );
      }
      return Promise.resolve(jsonResponse({}));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function wrap(child: ReactNode): JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/incidents"]}>{child}</MemoryRouter>
    </QueryClientProvider>
  );
}

const patches = () => calls.filter((c) => c.method === "PATCH");

describe("admin Incidents page", () => {
  it("shows a loading state then open incidents with the reporter's last four digits", async () => {
    render(wrap(<Incidents />));
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(await screen.findByText("Blade chipped on the miter saw")).toBeInTheDocument();
    expect(screen.getByText(/by 0100/)).toBeInTheDocument();
    expect(screen.queryByText(/15555550100/)).not.toBeInTheDocument();
    const get = calls.find((c) => c.url.includes("/admin/incidents"));
    expect(get?.url).toBe("/v1/g/demo-garage/admin/incidents?status=open");
  });

  it("resolves an incident with the typed resolution notes", async () => {
    const user = userEvent.setup();
    render(wrap(<Incidents />));
    await screen.findByText("Blade chipped on the miter saw");
    await user.type(screen.getByPlaceholderText("Resolution notes (optional)"), "Replaced blade");
    await user.click(screen.getByRole("button", { name: "Mark resolved" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]?.url).toBe("/v1/g/demo-garage/admin/incidents/inc_1");
    expect(patches()[0]?.body).toEqual({ status: "resolved", resolution_notes: "Replaced blade" });
  });

  it("resolves without notes when none were typed, and closes with status only", async () => {
    const user = userEvent.setup();
    render(wrap(<Incidents />));
    await screen.findByText("Blade chipped on the miter saw");
    await user.click(screen.getByRole("button", { name: "Mark resolved" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches()[0]?.body).toEqual({ status: "resolved" });
    expect(patches()[1]?.body).toEqual({ status: "closed" });
  });

  it("switches status filters, hides actions for non-open incidents, and shows an empty view", async () => {
    const user = userEvent.setup();
    render(wrap(<Incidents />));
    await screen.findByText("Blade chipped on the miter saw");

    await user.click(screen.getByRole("button", { name: "resolved" }));
    const item = (await screen.findByText("Fixed already")).closest("li");
    expect(item).not.toBeNull();
    expect(within(item as HTMLElement).queryByRole("button", { name: "Mark resolved" })).toBeNull();
    expect(calls.some((c) => c.url.endsWith("/admin/incidents?status=resolved"))).toBe(true);

    await user.click(screen.getByRole("button", { name: "all" }));
    expect(await screen.findByText("No incidents in this view.")).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith("/admin/incidents"))).toBe(true);
  });
});
