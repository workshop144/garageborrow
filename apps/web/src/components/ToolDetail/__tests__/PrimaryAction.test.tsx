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

  it("renders the family-only button as an sms link to the number the API sent", () => {
    render(
      <PrimaryAction
        item={makeItem({ min_tier: "family" })}
        mode="family_only"
        waitlistSize={0}
        onClick={vi.fn()}
        contactHref="sms:+15555550000"
      />,
    );
    const link = screen.getByRole("link", { name: /Text Dad about Hand Drill/ });
    expect(link).toHaveAttribute("href", "sms:+15555550000");
  });

  it("has no number of its own: without the API's link it shows a note, not a link (F12)", () => {
    for (const contactHref of [undefined, null, "javascript:alert(1)"]) {
      const { unmount } = render(
        <PrimaryAction
          item={makeItem({ min_tier: "family" })}
          mode="family_only"
          waitlistSize={0}
          onClick={vi.fn()}
          contactHref={contactHref}
        />,
      );
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.getByRole("note")).toHaveTextContent(
        "Family only — ask the owner about Hand Drill",
      );
      unmount();
    }
  });
});
