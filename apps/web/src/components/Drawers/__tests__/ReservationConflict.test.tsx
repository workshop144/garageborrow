import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Instance } from "@garageborrow/shared";

import { ReservationConflict } from "../ReservationConflict";

function inst(id: string, label: string): Instance {
  return {
    id,
    item_id: "item-1",
    garage_id: "g1",
    label,
    quality_tier: "good",
    status: "available",
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
  };
}

describe("ReservationConflict", () => {
  it("renders suggested alternates and triggers onPickAlternate", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const onNext = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ReservationConflict
        details={{ suggested_alternates: ["inst-2"], next_available_date: "2026-05-01T00:00:00Z" }}
        instances={[inst("inst-1", "Drill A"), inst("inst-2", "Drill B")]}
        onPickAlternate={onPick}
        onTryNextDate={onNext}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByText("Just snagged by someone else.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Drill B/ }));
    expect(onPick).toHaveBeenCalledWith("inst-2");
  });

  it("offers a 'Try [next available date]' button when only a date is suggested", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    render(
      <ReservationConflict
        details={{ next_available_date: "2026-05-01T00:00:00Z" }}
        instances={[]}
        onPickAlternate={vi.fn()}
        onTryNextDate={onNext}
        onDismiss={vi.fn()}
      />,
    );

    const btn = screen.getByRole("button", { name: /Try / });
    await user.click(btn);
    expect(onNext).toHaveBeenCalledWith("2026-05-01T00:00:00Z");
  });
});
