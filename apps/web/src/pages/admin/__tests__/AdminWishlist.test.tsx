import type { JSX, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import AdminWishlist from "../AdminWishlist";

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let pages: Record<string, { items: unknown[]; next_cursor?: string }>;
let decideStatus: number;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const recent = new Date(Date.now() - 2 * 86400_000).toISOString();

function row(over: Record<string, unknown>) {
  return {
    garage_id: "demo-garage",
    requester_phone: "+15555550100",
    status: "open",
    vote_count: 0,
    my_vote: false,
    created_at: "2026-04-20T12:00:00Z",
    updated_at: "2026-04-20T12:00:00Z",
    ...over,
  };
}

const WASHER = row({
  id: "wish_a",
  item_name: "Pressure washer",
  vote_count: 2,
  created_at: "2026-04-21T12:00:00Z",
  desired_by: "2026-06-01",
  description: "For the deck",
  reference_url: "https://example.com/washer",
});
const SPLITTER = row({
  id: "wish_b",
  item_name: "Log splitter",
  vote_count: 7,
  created_at: "2026-04-10T12:00:00Z",
});
const LADDER = row({
  id: "wish_c",
  item_name: "Extension ladder",
  vote_count: 1,
  created_at: "2026-04-25T12:00:00Z",
  desired_by: "2026-05-01",
});
const ACQUIRED = row({
  id: "wish_d",
  item_name: "Tile saw",
  status: "acquired",
  vote_count: 3,
  decided_at: recent,
});

beforeEach(() => {
  calls = [];
  decideStatus = 200;
  pages = {
    open: { items: [WASHER, SPLITTER, LADDER] },
    acquired: { items: [ACQUIRED] },
    declined: { items: [] },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      const method = init.method ?? "GET";
      calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const u = new URL(url, "http://x");
      if (u.pathname.endsWith("/wishlist")) {
        const status = u.searchParams.get("status") ?? "open";
        const cursor = u.searchParams.get("cursor");
        if (cursor === "page-2") return Promise.resolve(jsonResponse({ items: [ACQUIRED] }));
        return Promise.resolve(jsonResponse(pages[status] ?? { items: [] }));
      }
      if (u.pathname.endsWith("/items")) {
        return Promise.resolve(
          jsonResponse({ items: [{ id: "item_9", name: "Gas pressure washer" }] }),
        );
      }
      if (u.pathname.endsWith("/decide")) {
        return Promise.resolve(
          decideStatus === 200
            ? jsonResponse({ request: { ...WASHER, status: "acquired" } })
            : jsonResponse({ error: { code: "conflict", message: "Already decided" } }, 409),
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
      <MemoryRouter initialEntries={["/admin/wishlist"]}>{child}</MemoryRouter>
    </QueryClientProvider>
  );
}

function rowNames(): string[] {
  const table = screen.getByTestId("admin-wishlist-table");
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.querySelector("td")?.textContent ?? "");
}

const decides = () => calls.filter((c) => c.url.endsWith("/decide"));

async function openDrawer(user: ReturnType<typeof userEvent.setup>, id = "wish_a") {
  await user.click(await screen.findByTestId(`admin-wishlist-row-${id}`));
  return screen.getByTestId("admin-wishlist-drawer");
}

describe("AdminWishlist", () => {
  it("loads open requests sorted by votes and shows stats", async () => {
    render(wrap(<AdminWishlist />));
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    await screen.findByTestId("admin-wishlist-table");
    expect(rowNames()).toEqual(["Log splitter", "Pressure washer", "Extension ladder"]);
    expect(screen.getByText("Log splitter (7)")).toBeInTheDocument();
    expect(calls.map((c) => c.url)).toContain("/v1/g/demo-garage/wishlist?status=open");
  });

  it("re-sorts by date and by desired-by (undated rows last)", async () => {
    const user = userEvent.setup();
    render(wrap(<AdminWishlist />));
    await screen.findByTestId("admin-wishlist-table");
    await user.click(screen.getByRole("button", { name: "date" }));
    expect(rowNames()).toEqual(["Extension ladder", "Pressure washer", "Log splitter"]);
    await user.click(screen.getByRole("button", { name: "desired" }));
    expect(rowNames()).toEqual(["Extension ladder", "Pressure washer", "Log splitter"]);
  });

  it("filters by status, counts recent acquisitions, and shows an empty state", async () => {
    const user = userEvent.setup();
    render(wrap(<AdminWishlist />));
    await screen.findByTestId("admin-wishlist-table");
    await user.click(screen.getByRole("button", { name: "acquired" }));
    await waitFor(() => expect(rowNames()).toEqual(["Tile saw"]));
    const acquiredStat = screen.getByText("Acquired (30d)").parentElement;
    expect(acquiredStat).toHaveTextContent("1");

    await user.click(screen.getByRole("button", { name: "declined" }));
    expect(await screen.findByText("Nothing here.")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("loads the next page via Show more", async () => {
    pages.open = { items: [WASHER], next_cursor: "page-2" };
    const user = userEvent.setup();
    render(wrap(<AdminWishlist />));
    await user.click(await screen.findByRole("button", { name: "Show more" }));
    await waitFor(() => expect(rowNames()).toContain("Tile saw"));
    expect(calls.some((c) => c.url.includes("cursor=page-2"))).toBe(true);
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("shows request details in the drawer and closes it", async () => {
    const user = userEvent.setup();
    render(wrap(<AdminWishlist />));
    const drawer = await openDrawer(user);
    expect(within(drawer).getByText(/2 votes · needs by 2026-06-01/)).toBeInTheDocument();
    expect(within(drawer).getByText("For the deck")).toBeInTheDocument();
    expect(within(drawer).getByRole("link")).toHaveAttribute("href", "https://example.com/washer");
    await user.click(within(drawer).getAllByRole("button", { name: "Close" })[1] as HTMLElement);
    expect(screen.queryByTestId("admin-wishlist-drawer")).not.toBeInTheDocument();
  });

  it("marks a request acquired with the chosen item and closes on success", async () => {
    const user = userEvent.setup();
    render(wrap(<AdminWishlist />));
    const drawer = await openDrawer(user, "wish_c");
    expect(within(drawer).getByText(/1 vote ·/)).toBeInTheDocument();
    await user.click(within(drawer).getByTestId("admin-wishlist-mark-acquired"));
    const submit = within(drawer).getByTestId("admin-wishlist-submit");
    expect(submit).toBeDisabled();
    const select = within(drawer).getByTestId("admin-wishlist-acquired-select");
    await within(select).findByRole("option", { name: "Gas pressure washer" });
    await user.selectOptions(select, "item_9");
    await user.click(submit);
    await waitFor(() =>
      expect(screen.queryByTestId("admin-wishlist-drawer")).not.toBeInTheDocument(),
    );
    expect(decides()[0]?.url).toBe("/v1/g/demo-garage/admin/wishlist/wish_c/decide");
    expect(decides()[0]?.body).toEqual({ decision: "acquired", acquired_item_id: "item_9" });
  });

  it("declines with a reason, or without one when left blank", async () => {
    const user = userEvent.setup();
    render(wrap(<AdminWishlist />));
    let drawer = await openDrawer(user);
    await user.click(within(drawer).getByTestId("admin-wishlist-decline"));
    await user.type(within(drawer).getByTestId("admin-wishlist-decline-reason"), "Too pricey");
    await user.click(within(drawer).getByTestId("admin-wishlist-submit"));
    await waitFor(() => expect(decides()).toHaveLength(1));
    expect(decides()[0]?.body).toEqual({ decision: "declined", decline_reason: "Too pricey" });

    await waitFor(() =>
      expect(screen.queryByTestId("admin-wishlist-drawer")).not.toBeInTheDocument(),
    );
    drawer = await openDrawer(user, "wish_b");
    await user.click(within(drawer).getByTestId("admin-wishlist-decline"));
    await user.click(within(drawer).getByTestId("admin-wishlist-submit"));
    await waitFor(() => expect(decides()).toHaveLength(2));
    expect(decides()[1]?.body).toEqual({ decision: "declined" });
  });

  it("marks a duplicate of another open request and surfaces API errors", async () => {
    decideStatus = 409;
    const user = userEvent.setup();
    render(wrap(<AdminWishlist />));
    const drawer = await openDrawer(user);
    await user.click(within(drawer).getByTestId("admin-wishlist-mark-duplicate"));
    const select = within(drawer).getByTestId("admin-wishlist-duplicate-select");
    const options = within(select)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual([
      "— select an open request —",
      "Log splitter (7)",
      "Extension ladder (1)",
    ]);
    await user.selectOptions(select, "wish_b");
    await user.click(within(drawer).getByTestId("admin-wishlist-submit"));
    expect(await within(drawer).findByText("Already decided")).toBeInTheDocument();
    expect(decides()[0]?.body).toEqual({ decision: "duplicate", duplicate_of_id: "wish_b" });
    expect(screen.getByTestId("admin-wishlist-drawer")).toBeInTheDocument();
  });

  it("shows decided requests as read-only", async () => {
    const user = userEvent.setup();
    render(wrap(<AdminWishlist />));
    await screen.findByTestId("admin-wishlist-table");
    await user.click(screen.getByRole("button", { name: "acquired" }));
    const drawer = await openDrawer(user, "wish_d");
    expect(within(drawer).getByText("Already acquired.")).toBeInTheDocument();
    expect(within(drawer).getByText(/no rush/)).toBeInTheDocument();
    expect(within(drawer).queryByTestId("admin-wishlist-decline")).toBeNull();
  });
});
