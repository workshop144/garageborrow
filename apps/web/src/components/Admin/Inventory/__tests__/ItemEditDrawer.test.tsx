import type { JSX, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ItemEditDrawer } from "../ItemEditDrawer";
import type { AdminItem } from "../../../../hooks/useAdminItems";

const uploadPhotoMock = vi.fn();
vi.mock("../../../../lib/uploadPhoto", () => ({
  uploadPhoto: (...args: unknown[]) => uploadPhotoMock(...args) as unknown,
}));

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };
let calls: Call[];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  calls = [];
  uploadPhotoMock.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        headers: init.headers as Record<string, string>,
      });
      return Promise.resolve(jsonResponse({ item: { id: "item_1" } }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const ITEM = {
  id: "item_1",
  garage_id: "demo-garage",
  name: "Cordless drill",
  description: "18V with two batteries",
  category: "Power tools",
  primary_photo_key: "photos/drill.jpg",
  handling_notes: null,
  default_duration_days: 5,
  requires_approval: true,
  min_tier: "friend",
  auto_approve_tier: "family",
  approx_value: 120,
  tags: ["drill", "18v"],
  available_count: 1,
  total_count: 1,
  borrows_total: 4,
  borrows_last_30d: 1,
} as unknown as AdminItem;

function renderDrawer(item: AdminItem | null, onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const utils = render(
    <ItemEditDrawer
      open
      onClose={onClose}
      item={item}
      knownCategories={["Power tools", "Garden"]}
    />,
    { wrapper: Wrapper },
  );
  return { ...utils, onClose };
}

describe("ItemEditDrawer", () => {
  it("renders nothing when closed", () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <ItemEditDrawer open={false} onClose={vi.fn()} item={null} knownCategories={[]} />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId("item-edit-drawer")).not.toBeInTheDocument();
  });

  it("creates a new tool with defaults, typed fields and tags", async () => {
    const user = userEvent.setup();
    const { onClose, container } = renderDrawer(null);
    expect(screen.getByRole("dialog", { name: "Add a tool" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retire item" })).toBeNull();
    expect(
      Array.from(container.ownerDocument.querySelectorAll("#admin-item-categories option")).map(
        (o) => o.getAttribute("value"),
      ),
    ).toEqual(["Power tools", "Garden"]);

    // Missing name/category: Save is a no-op.
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(calls).toHaveLength(0);

    await user.type(screen.getByLabelText("Name"), "Leaf blower");
    await user.type(screen.getByLabelText("Category"), "Garden");
    await user.type(screen.getByLabelText("Description"), "Gas");
    await user.type(screen.getByLabelText("Handling notes"), "Mix fuel");
    const duration = screen.getByLabelText("Default duration (days)");
    await user.clear(duration);
    await user.type(duration, "7");
    await user.type(screen.getByLabelText("Approx value ($)"), "80");
    await user.click(screen.getByLabelText("Requires approval"));
    await user.selectOptions(screen.getByLabelText("Min tier"), "friend");
    await user.selectOptions(screen.getByLabelText("Auto-approve tier"), "howdy");

    const tag = screen.getByPlaceholderText("Add tag…");
    await user.type(tag, "yard{Enter}");
    await user.type(tag, "gas,");
    await user.type(tag, "yard{Enter}"); // duplicate ignored
    await user.type(tag, "   {Enter}"); // blank ignored
    await user.type(tag, "temp");
    await user.tab(); // blur commits
    expect(screen.getByRole("button", { name: "Remove temp" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove gas" }));
    await user.click(tag);
    await user.keyboard("{Backspace}"); // removes trailing "temp"
    expect(screen.queryByRole("button", { name: "Remove temp" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("/v1/g/demo-garage/items");
    expect(calls[0]?.headers["Idempotency-Key"]).toBeTruthy();
    expect(calls[0]?.body).toEqual({
      name: "Leaf blower",
      category: "Garden",
      description: "Gas",
      handling_notes: "Mix fuel",
      default_duration_days: 7,
      approx_value: 80,
      requires_approval: true,
      min_tier: "friend",
      auto_approve_tier: "howdy",
      tags: ["yard"],
    });
  });

  it("seeds the form from an existing item and PATCHes edits", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDrawer(ITEM);
    expect(screen.getByRole("dialog", { name: "Edit tool" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Cordless drill");
    expect(screen.getByLabelText("Requires approval")).toBeChecked();
    expect(screen.getByLabelText("Min tier")).toHaveValue("friend");
    expect(screen.getByText("Key: photos/drill.jpg")).toBeInTheDocument();

    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Impact driver");
    await user.clear(screen.getByLabelText("Approx value ($)"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toBe("/v1/g/demo-garage/items/item_1");
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.name).toBe("Impact driver");
    expect(body.handling_notes).toBe("");
    expect(body).not.toHaveProperty("approx_value");
    expect(body.tags).toEqual(["drill", "18v"]);
  });

  it("retires an existing item", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDrawer(ITEM);
    await user.click(screen.getByRole("button", { name: "Retire item" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("/v1/g/demo-garage/items/item_1/retire");
  });

  it("uploads a photo and stores the returned key", async () => {
    uploadPhotoMock.mockResolvedValue({ key: "photos/new.jpg" });
    const user = userEvent.setup();
    const { container } = renderDrawer(null);
    const input = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "tool.jpg", { type: "image/jpeg" });
    await user.upload(input, file);
    expect(await screen.findByText("Key: photos/new.jpg")).toBeInTheDocument();
    expect(uploadPhotoMock).toHaveBeenCalledWith(file, "tool_photo");
    expect(screen.queryByText("Uploading…")).toBeNull();
  });

  it("shows the upload error message, or a fallback for non-Error rejections", async () => {
    uploadPhotoMock.mockRejectedValueOnce(new Error("Too large")).mockRejectedValueOnce("boom");
    const user = userEvent.setup();
    const { container } = renderDrawer(null);
    const input = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["x"], "a.jpg", { type: "image/jpeg" }));
    expect(await screen.findByText("Too large")).toBeInTheDocument();
    await user.upload(input, new File(["y"], "b.jpg", { type: "image/jpeg" }));
    expect(await screen.findByText("Upload failed")).toBeInTheDocument();
  });

  it("closes via Cancel", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDrawer(null);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });
});
