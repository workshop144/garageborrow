import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { VisibilityPreview } from "../VisibilityPreview";

describe("VisibilityPreview", () => {
  it("renders both visible and hidden previews side by side", () => {
    render(<VisibilityPreview displayName="Bob Smith" />);
    const visible = screen.getByTestId("visibility-preview-visible");
    const hidden = screen.getByTestId("visibility-preview-hidden");
    expect(visible).toHaveTextContent("Bob S.");
    expect(visible).toHaveTextContent("12 borrows total");
    expect(hidden).toHaveTextContent("A neighbor has the trailer until Sat.");
    expect(hidden).not.toHaveTextContent("Bob");
  });

  it("falls back gracefully when display name is empty", () => {
    render(<VisibilityPreview displayName="" />);
    expect(screen.getByTestId("visibility-preview-visible")).toHaveTextContent("Friend");
  });

  it("uses single name as-is when no last initial available", () => {
    render(<VisibilityPreview displayName="Cher" />);
    expect(screen.getByTestId("visibility-preview-visible")).toHaveTextContent("Cher");
  });
});
