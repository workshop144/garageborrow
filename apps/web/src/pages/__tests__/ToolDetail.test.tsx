import type { JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import ToolDetail from "../ToolDetail";

// The borrow drawer has its own tests; here we only care how the page drives it.
vi.mock("../../components/Drawers/BorrowDrawer", () => ({
  BorrowDrawer: (props: {
    open: boolean;
    mode: string;
    onClose: () => void;
    onSuccess: () => void;
  }): JSX.Element | null =>
    props.open ? (
      <div data-testid="borrow-drawer" data-mode={props.mode}>
        <button type="button" onClick={props.onClose}>
          stub close
        </button>
        <button type="button" onClick={props.onSuccess}>
          stub success
        </button>
      </div>
    ) : null,
}));

type Call = { url: string; method: string };
let calls: Call[];
let detail: Record<string, unknown> | null;
let detailStatus: number;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeItem(over: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    garage_id: "demo-garage",
    name: "Hand Drill",
    description: "Cordless, two batteries",
    category: "tools",
    primary_photo_key: "drill.jpg",
    default_duration_days: 3,
    requires_approval: false,
    min_tier: "howdy",
    auto_approve_tier: "family",
    tags: ["drill", "power"],
    status: "available",
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    access: "instant",
    available_count: 1,
    total_count: 1,
    borrows_total: 0,
    borrows_last_30d: 0,
    ...over,
  };
}

function makeDetail(over: Record<string, unknown> = {}, itemOver: Record<string, unknown> = {}) {
  return {
    item: makeItem(itemOver),
    instances: [],
    status_pills: [],
    handling_notes: "",
    waitlist_size: 0,
    my_waitlist_entry: null,
    ...over,
  };
}

beforeEach(() => {
  calls = [];
  detailStatus = 200;
  detail = makeDetail();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      const method = init.method ?? "GET";
      calls.push({ url, method });
      if (url.endsWith("/items/item-1") && method === "GET") {
        return Promise.resolve(
          detailStatus === 200
            ? jsonResponse(detail)
            : jsonResponse({ error: { code: "not_found", message: "nope" } }, detailStatus),
        );
      }
      if (url.endsWith("/waitlist") && method === "POST") {
        detail = { ...detail, waitlist_size: 3, my_waitlist_entry: { id: "wl-1", position: 3 } };
        return Promise.resolve(jsonResponse({ entry: { id: "wl-1", position: 1 } }, 201));
      }
      if (method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(jsonResponse({}));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/tools/item-1"]}>
        <Routes>
          <Route path="/tools/:id" element={<ToolDetail />} />
          <Route path="/me" element={<div>MY STUFF</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sent = (method: string, suffix: string) =>
  calls.filter((c) => c.method === method && c.url.endsWith(suffix));

describe("ToolDetail page", () => {
  it("shows loading, then the tool's details", async () => {
    detail = makeDetail(
      { handling_notes: "Charge after use" },
      { donated_by_display: "a neighbour" },
    );
    renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Hand Drill" })).toBeInTheDocument();
    expect(screen.getByText("#drill")).toBeInTheDocument();
    expect(screen.getByText("#power")).toBeInTheDocument();
    expect(screen.getByText("Donated by a neighbour")).toBeInTheDocument();
    expect(screen.getByText("Cordless, two batteries")).toBeInTheDocument();
    expect(screen.getByText(/Charge after use/)).toBeInTheDocument();
    expect(sent("GET", "/v1/g/demo-garage/items/item-1")).toHaveLength(1);
    expect(screen.queryByText("Pick yours")).toBeNull();
  });

  it("shows an error message when the tool can't load", async () => {
    detailStatus = 404;
    renderPage();
    expect(await screen.findByText("Couldn't load this tool.")).toBeInTheDocument();
  });

  it("opens the instant borrow drawer, then celebrates and navigates to My Stuff", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Borrow it" }));
    expect(screen.getByTestId("borrow-drawer")).toHaveAttribute("data-mode", "instant");
    await user.click(screen.getByRole("button", { name: "stub close" }));
    expect(screen.queryByTestId("borrow-drawer")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Borrow it" }));
    await user.click(screen.getByRole("button", { name: "stub success" }));
    expect(screen.getByText("It's yours!")).toBeInTheDocument();
    expect(await screen.findByText("MY STUFF", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("uses request mode for request-access tools and opens the drawer from an instance pick", async () => {
    detail = makeDetail(
      {
        instances: [
          {
            id: "inst-a",
            item_id: "item-1",
            label: "Blue",
            quality_tier: "good",
            status: "available",
          },
          {
            id: "inst-b",
            item_id: "item-1",
            label: "Red",
            quality_tier: "fair",
            status: "available",
          },
        ],
      },
      { access: "request" },
    );
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("Pick yours")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request to borrow" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Blue/ }));
    expect(screen.getByTestId("borrow-drawer")).toHaveAttribute("data-mode", "request");
  });

  it("family-only tools render an sms link and never open the drawer", async () => {
    detail = makeDetail({}, { min_tier: "family" });
    renderPage();
    expect(
      await screen.findByRole("link", { name: /^Text .+ about Hand Drill/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Borrow it" })).toBeNull();
  });

  it("joins the waitlist when every copy is out, with an optimistic position", async () => {
    detail = makeDetail({ waitlist_size: 2 }, { status: "all_loaned" });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Join waitlist (#3 in line)" }));
    expect(await screen.findByTestId("waitlist-position")).toHaveTextContent("You're #3 in line.");
    await waitFor(() =>
      expect(sent("POST", "/v1/g/demo-garage/items/item-1/waitlist")).toHaveLength(1),
    );
    expect(screen.queryByTestId("borrow-drawer")).toBeNull();
  });

  it("a member already in line can leave, and clicking the primary button does nothing", async () => {
    detail = makeDetail(
      { waitlist_size: 1, my_waitlist_entry: { id: "wl-9", position: 1 } },
      { status: "available" },
    );
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByTestId("waitlist-position")).toHaveTextContent("#1 in line");
    await user.click(screen.getByRole("button", { name: /Join waitlist/ }));
    expect(sent("POST", "/waitlist")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Leave waitlist" }));
    await waitFor(() => expect(sent("DELETE", "/v1/g/demo-garage/waitlist/wl-9")).toHaveLength(1));
  });
});
