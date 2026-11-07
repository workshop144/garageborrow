import type { JSX, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { SettingsForm } from "../SettingsForm";

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };
let calls: Call[];
let garage: Record<string, unknown>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const GARAGE = {
  id: "demo-garage",
  name: "Demo Garage",
  status: "open",
  closed_until_date: null,
  tier_labels: { howdy: "Howdy", friend: "Friend", family: "Family" },
  quality_tiers: ["Good", "Fair"],
  payforward_orgs: [
    { name: "Food Pantry", display_order: 0 },
    { name: "Animal Shelter", display_order: 1 },
  ],
  payforward_intro_copy: null,
  vouching_required: false,
  ai_enabled: false,
  ai_min_tier: "friend",
  ai_default_user_monthly_tokens: 1000,
  ai_total_monthly_cap_cents: 500,
  ai_default_model: "haiku",
};

beforeEach(() => {
  calls = [];
  garage = { ...GARAGE };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      const method = init.method ?? "GET";
      calls.push({
        url,
        method,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        headers: init.headers as Record<string, string>,
      });
      if (method === "PATCH") {
        garage = { ...garage, ...(JSON.parse(String(init.body)) as Record<string, unknown>) };
      }
      return Promise.resolve(jsonResponse({ garage }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<SettingsForm />, { wrapper: Wrapper });
}

const patches = () => calls.filter((c) => c.method === "PATCH");

describe("SettingsForm", () => {
  it("loads settings from the admin endpoint into the form", async () => {
    renderForm();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(await screen.findByLabelText("Name")).toHaveValue("Demo Garage");
    expect(calls[0]?.url).toBe("/v1/g/demo-garage/admin/settings");
    expect(screen.getByLabelText("Quality tiers (comma-separated)")).toHaveValue("Good, Fair");
    expect(screen.getByDisplayValue("Food Pantry")).toBeInTheDocument();
    expect(screen.getByText("Coming soon — keep checking back.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Closed until")).toBeNull();
  });

  it("saves the unchanged draft without closed_until_date when it is blank", async () => {
    const user = userEvent.setup();
    renderForm();
    await screen.findByLabelText("Name");
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]?.url).toBe("/v1/g/demo-garage/admin/settings");
    expect(patches()[0]?.headers["Idempotency-Key"]).toBeTruthy();
    expect(patches()[0]?.body).toEqual({
      name: "Demo Garage",
      status: "open",
      tier_labels: GARAGE.tier_labels,
      quality_tiers: ["Good", "Fair"],
      payforward_orgs: GARAGE.payforward_orgs,
      payforward_intro_copy: "",
      vouching_required: false,
      ai_enabled: false,
      ai_min_tier: "friend",
      ai_default_user_monthly_tokens: 1000,
      ai_total_monthly_cap_cents: 500,
      ai_default_model: "haiku",
    });
    // The settings query is refetched after the save.
    await waitFor(() => expect(calls.filter((c) => c.method === "GET")).toHaveLength(2));
  });

  it("sends every edited field in the PATCH", async () => {
    const user = userEvent.setup();
    renderForm();
    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Sample Shed");
    await user.selectOptions(screen.getByLabelText("Status"), "closed_until");
    const until = screen.getByLabelText("Closed until");
    await user.type(until, "2026-12-01");
    const friend = screen.getByLabelText("friend label");
    await user.clear(friend);
    await user.type(friend, "Buddy");
    const quality = screen.getByLabelText("Quality tiers (comma-separated)");
    await user.clear(quality);
    await user.click(quality);
    await user.paste("Like new, , Worn ");
    await user.click(screen.getByLabelText("Vouching required for new members"));
    await user.type(screen.getByLabelText("Intro copy"), "Give back");

    // Edit, remove and add orgs: the remaining list is renumbered.
    // fireEvent rather than user.type: the org row is keyed on its name, so the
    // input remounts (and loses focus) on every keystroke.
    fireEvent.change(screen.getByDisplayValue("Food Pantry"), {
      target: { value: "Tool Library" },
    });
    await user.click(screen.getAllByRole("button", { name: "Remove" })[1] as HTMLElement);
    await user.click(screen.getByRole("button", { name: "Add organization" }));
    expect(screen.getByDisplayValue("New org")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Enable AI"));
    expect(screen.queryByText("Coming soon — keep checking back.")).toBeNull();
    await user.selectOptions(screen.getByLabelText("Min tier"), "family");
    await user.selectOptions(screen.getByLabelText("Default model"), "sonnet");
    const tokens = screen.getByLabelText("Per-user monthly tokens");
    await user.clear(tokens);
    await user.type(tokens, "2500");
    const cap = screen.getByLabelText("Garage monthly cap (cents)");
    await user.clear(cap);
    await user.type(cap, "900");

    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]?.body).toEqual({
      name: "Sample Shed",
      status: "closed_until",
      closed_until_date: "2026-12-01",
      tier_labels: { howdy: "Howdy", friend: "Buddy", family: "Family" },
      quality_tiers: ["Like new", "Worn"],
      payforward_orgs: [
        { name: "Tool Library", display_order: 0 },
        { name: "New org", display_order: 1 },
      ],
      payforward_intro_copy: "Give back",
      vouching_required: true,
      ai_enabled: true,
      ai_min_tier: "family",
      ai_default_user_monthly_tokens: 2500,
      ai_total_monthly_cap_cents: 900,
      ai_default_model: "sonnet",
    });
    // Fresh server data re-seeds the draft.
    await waitFor(() => expect(screen.getByLabelText("Closed until")).toHaveValue("2026-12-01"));
  });
});
