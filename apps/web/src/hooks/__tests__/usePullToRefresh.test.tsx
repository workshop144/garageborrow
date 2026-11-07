import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePullToRefresh } from "../usePullToRefresh";

function touch(type: string, clientY?: number): void {
  const ev = new Event(type);
  Object.defineProperty(ev, "touches", {
    value: clientY === undefined ? [] : [{ clientY }],
  });
  act(() => {
    window.dispatchEvent(ev);
  });
}

function setScrollY(y: number): void {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true, writable: true });
}

afterEach(() => setScrollY(0));

describe("usePullToRefresh", () => {
  it("damps the pull distance by the resistance and caps it at 1.5x threshold", () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh, threshold: 40, resistance: 2 }),
    );
    touch("touchstart", 100);
    touch("touchmove", 140);
    expect(result.current.pull).toBe(20);
    touch("touchmove", 400);
    expect(result.current.pull).toBe(60);
    touch("touchmove", 90);
    expect(result.current.pull).toBe(0);
  });

  it("refreshes once the pull passes the threshold, then resets", async () => {
    let finish!: () => void;
    const onRefresh = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh, threshold: 40, resistance: 1 }),
    );
    touch("touchstart", 0);
    touch("touchmove", 50);
    touch("touchend");
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(true);
    expect(result.current.pull).toBe(50);

    await act(async () => {
      finish();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.pull).toBe(0);
  });

  it("snaps back without refreshing on a short pull or cancel", () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(() => usePullToRefresh({ onRefresh }));
    touch("touchstart", 0);
    touch("touchmove", 50); // 50 / 2.2 < 64
    expect(result.current.pull).toBeGreaterThan(0);
    touch("touchcancel");
    expect(result.current.pull).toBe(0);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("ignores gestures that start while the page is scrolled", () => {
    const onRefresh = vi.fn();
    setScrollY(120);
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh, threshold: 10, resistance: 1 }),
    );
    touch("touchstart", 0);
    touch("touchmove", 200);
    touch("touchend");
    expect(result.current.pull).toBe(0);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("ignores touch events without touch points and moves without a start", () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh, threshold: 10, resistance: 1 }),
    );
    touch("touchmove", 200);
    expect(result.current.pull).toBe(0);
    touch("touchstart");
    touch("touchmove", 200);
    expect(result.current.pull).toBe(0);
    touch("touchstart", 0);
    touch("touchmove");
    expect(result.current.pull).toBe(0);
    touch("touchend");
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("removes its listeners on unmount", () => {
    const onRefresh = vi.fn();
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => usePullToRefresh({ onRefresh }));
    unmount();
    const types = remove.mock.calls.map((c) => c[0]);
    expect(types).toEqual(
      expect.arrayContaining(["touchstart", "touchmove", "touchend", "touchcancel"]),
    );
    remove.mockRestore();
  });
});
