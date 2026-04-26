import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  FamilyPromotionOverlay,
  celebrationStorageKey,
  hasSeenCelebration,
} from "../FamilyPromotionOverlay";

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
  };
});

const confettiMock = vi.fn();
vi.mock("canvas-confetti", () => ({
  default: (...args: unknown[]) => confettiMock(...args),
}));

beforeEach(() => {
  confettiMock.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("FamilyPromotionOverlay", () => {
  it("shows once on first family-tier render and persists dismissal", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const { rerender } = render(
      <FamilyPromotionOverlay userKey="+15555550100" shouldCelebrate onDismiss={onDismiss} />,
    );

    expect(screen.getByTestId("family-celebration")).toBeInTheDocument();

    await user.click(screen.getByTestId("family-celebration-dismiss"));

    await waitFor(() => expect(screen.queryByTestId("family-celebration")).not.toBeInTheDocument());
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(celebrationStorageKey("+15555550100"))).toBe("1");
    expect(hasSeenCelebration("+15555550100")).toBe(true);

    // Re-render: should not show again.
    rerender(<FamilyPromotionOverlay userKey="+15555550100" shouldCelebrate />);
    expect(screen.queryByTestId("family-celebration")).not.toBeInTheDocument();
  });

  it("does not show when shouldCelebrate is false", () => {
    render(<FamilyPromotionOverlay userKey="+15555550100" shouldCelebrate={false} />);
    expect(screen.queryByTestId("family-celebration")).not.toBeInTheDocument();
  });

  it("does not show when localStorage already records a previous dismissal", () => {
    window.localStorage.setItem(celebrationStorageKey("+15555550100"), "1");
    render(<FamilyPromotionOverlay userKey="+15555550100" shouldCelebrate />);
    expect(screen.queryByTestId("family-celebration")).not.toBeInTheDocument();
  });
});
