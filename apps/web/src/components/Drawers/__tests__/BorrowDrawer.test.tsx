import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Instance, ItemDetail } from "@garageborrow/shared";

import { BorrowDrawer, pickDefaultChip } from "../BorrowDrawer";

// Mock the network-touching hook so the drawer test stays a pure UI test.
const mutate = vi.fn();
const reset = vi.fn();
vi.mock("../../../hooks/useBorrow", () => ({
  useBorrow: () => ({
    mutate,
    reset,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

// framer-motion's AnimatePresence + spring transitions are noisy in jsdom.
// Replace motion components with plain divs and let AnimatePresence pass
// children through unchanged.
vi.mock("framer-motion", async () => {
  const React = await import("react");
  type DivProps = React.HTMLAttributes<HTMLDivElement>;
  const Passthrough = React.forwardRef<HTMLDivElement, DivProps>(({ children, ...rest }, ref) =>
    React.createElement("div", { ref, ...rest }, children),
  );
  Passthrough.displayName = "MotionPassthrough";
  return {
    motion: new Proxy(
      {},
      {
        get: () => Passthrough,
      },
    ),
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    MotionConfig: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

function makeItem(overrides: Partial<ItemDetail> = {}): ItemDetail {
  return {
    id: "item-1",
    garage_id: "g1",
    name: "Hand Drill",
    description: "Cordless drill.",
    category: "power-tool",
    primary_photo_key: "drill.jpg",
    default_duration_days: 3,
    requires_approval: false,
    min_tier: "howdy",
    auto_approve_tier: "family",
    tags: ["drill"],
    status: "available",
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    access: "instant",
    available_count: 1,
    total_count: 1,
    borrows_total: 0,
    borrows_last_30d: 0,
    ...overrides,
  };
}

function makeInstance(overrides: Partial<Instance> = {}): Instance {
  return {
    id: "inst-1",
    item_id: "item-1",
    garage_id: "g1",
    label: "Drill A",
    quality_tier: "good",
    status: "available",
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

function renderDrawer(props: { item: ItemDetail; instances: Instance[]; onSuccess?: () => void }) {
  const onClose = vi.fn();
  const onSuccess = props.onSuccess ?? vi.fn();
  const utils = render(
    <BorrowDrawer
      open
      onClose={onClose}
      item={props.item}
      instances={props.instances}
      mode="instant"
      onSuccess={onSuccess}
    />,
  );
  return { ...utils, onClose, onSuccess };
}

describe("pickDefaultChip", () => {
  it("picks 'one-week' when default_duration_days is 7", () => {
    expect(pickDefaultChip(7).id).toBe("one-week");
  });

  it("picks 'two-weeks' when default_duration_days is 14", () => {
    expect(pickDefaultChip(14).id).toBe("two-weeks");
  });

  it("picks 'today' when default_duration_days is 1", () => {
    expect(pickDefaultChip(1).id).toBe("today");
  });
});

describe("BorrowDrawer state transitions", () => {
  beforeEach(() => {
    cleanup();
    mutate.mockReset();
    reset.mockReset();
  });

  it("with one instance starts on the date step (skips instance pick)", () => {
    renderDrawer({
      item: makeItem(),
      instances: [makeInstance()],
    });
    expect(screen.getByTestId("date-chips")).toBeInTheDocument();
  });

  it("with multiple instances starts on the instance step", () => {
    renderDrawer({
      item: makeItem(),
      instances: [makeInstance(), makeInstance({ id: "inst-2", label: "Drill B" })],
    });
    expect(screen.getByText("Pick the one you want")).toBeInTheDocument();
  });

  it("walks instance → date → note → liability and confirms", async () => {
    const user = userEvent.setup();
    renderDrawer({
      item: makeItem({ default_duration_days: 7 }),
      instances: [makeInstance(), makeInstance({ id: "inst-2", label: "Drill B" })],
    });

    await user.click(screen.getByText("Drill A"));
    expect(screen.getByText("When do you think you'll bring it back?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/Anything to tell Dad/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("liability-callout")).toBeInTheDocument();

    await user.click(screen.getByTestId("borrow-confirm"));
    expect(mutate).toHaveBeenCalledTimes(1);
    const [input] = mutate.mock.calls[0]!;
    expect(input).toMatchObject({
      itemId: "item-1",
      instanceId: "inst-1",
      durationDays: 7,
    });
  });

  it("default chip is selected on initial render based on item.default_duration_days", () => {
    renderDrawer({
      item: makeItem({ default_duration_days: 7 }),
      instances: [makeInstance()],
    });
    const oneWeek = screen.getByRole("button", { name: "In a week" });
    expect(oneWeek).toHaveAttribute("aria-pressed", "true");
  });
});
