import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { StepPhotos } from "../StepPhotos";
import type { DonateDraftPhoto } from "../../../hooks/useDonate";

vi.mock("react-easy-crop", () => ({
  default: ({ image }: { image: string }) => <img data-testid="cropper-stub" src={image} alt="" />,
}));

afterEach(() => {
  cleanup();
});

function makePhoto(idx: number): DonateDraftPhoto {
  return {
    previewUrl: `blob:test/photo-${idx}`,
    blob: new Blob([`x${idx}`], { type: "image/jpeg" }),
  };
}

describe("StepPhotos", () => {
  it("hides the add button when at the 3-photo limit", () => {
    render(<StepPhotos photos={[makePhoto(1), makePhoto(2), makePhoto(3)]} onChange={() => {}} />);
    expect(screen.queryByTestId("donate-photo-add")).not.toBeInTheDocument();
    expect(screen.getByText(/three is plenty/i)).toBeInTheDocument();
  });

  it("shows the add button when below the limit", () => {
    render(<StepPhotos photos={[makePhoto(1)]} onChange={() => {}} />);
    expect(screen.getByTestId("donate-photo-add")).toBeInTheDocument();
  });

  it("removes a photo when its remove button is clicked", () => {
    const onChange = vi.fn();
    render(<StepPhotos photos={[makePhoto(1), makePhoto(2)]} onChange={onChange} />);
    screen.getByTestId("donate-photo-remove-0").click();
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ previewUrl: "blob:test/photo-2" }),
    ]);
  });
});
