import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { StatsChips, computeStatLabels } from "../StatsChips";

describe("computeStatLabels", () => {
  it("returns three labels in expected order", () => {
    const labels = computeStatLabels({
      borrows_total: 12,
      returns_on_time: 11,
      borrows_active: 1,
    });
    expect(labels).toEqual(["12 borrowed", "11 on time", "1 out now"]);
  });

  it("handles a brand-new account with all zeros", () => {
    const labels = computeStatLabels({
      borrows_total: 0,
      returns_on_time: 0,
      borrows_active: 0,
    });
    expect(labels).toEqual(["0 borrowed", "0 on time", "0 out now"]);
  });
});

describe("StatsChips", () => {
  it("renders one chip per label", () => {
    render(<StatsChips stats={{ borrows_total: 5, returns_on_time: 4, borrows_active: 1 }} />);
    const chips = screen.getByTestId("stats-chips");
    expect(chips).toHaveTextContent("5 borrowed");
    expect(chips).toHaveTextContent("4 on time");
    expect(chips).toHaveTextContent("1 out now");
  });
});
