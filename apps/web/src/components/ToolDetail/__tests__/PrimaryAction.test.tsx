import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ItemDetail } from "@garageborrow/shared";

import { PrimaryAction } from "../PrimaryAction";

function makeItem(overrides: Partial<ItemDetail> = {}): ItemDetail {
  return {
    id: "item-1",
    garage_id: "g1",
    name: "Hand Drill",
    description: "",
    category: "tools",
    primary_photo_key: "drill.jpg",
    default_duration_days: 3,
    requires_approval: false,
    min_tier: "howdy",
    auto_approve_tier: "family",
    tags: [],
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

describe("PrimaryAction", () => {
  it("renders 'Borrow it' for instant access", () => {
    render(
      <PrimaryAction item={makeItem()} mode="borrow_instant" waitlistSize={0} onClick={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Borrow it" })).toBeInTheDocument();
  });

  it("renders 'Request to borrow' for request access", () => {
    render(
      <PrimaryAction item={makeItem()} mode="borrow_request" waitlistSize={0} onClick={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Request to borrow" })).toBeInTheDocument();
  });

  it("renders 'Join waitlist (#N in line)' with the next position", () => {
    render(
      <PrimaryAction
        item={makeItem({ status: "all_loaned" })}
        mode="waitlist"
        waitlistSize={2}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Join waitlist (#3 in line)" })).toBeInTheDocument();
  });

  it("renders 'Family only — text Dad' as a disabled-style sms link", () => {
    render(
      <PrimaryAction
        item={makeItem({ min_tier: "family" })}
        mode="family_only"
        waitlistSize={0}
        onClick={vi.fn()}
      />,
    );
    const link = screen.getByRole("link", { name: /Text Dad about Hand Drill/ });
    expect(link).toHaveAttribute("href", expect.stringMatching(/^sms:/));
  });
});
