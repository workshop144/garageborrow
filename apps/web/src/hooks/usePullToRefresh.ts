import { useEffect, useRef, useState } from "react";

type Options = {
  onRefresh: () => Promise<unknown> | void;
  threshold?: number;
  resistance?: number;
};

type State = {
  pull: number;
  refreshing: boolean;
};

export function usePullToRefresh({ onRefresh, threshold = 64, resistance = 2.2 }: Options): State {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const tracking = useRef(false);
  // The live pull distance and in-flight flag live in refs so the touchend
  // handler reads current values and never runs side effects inside a state
  // updater (StrictMode double-invokes those).
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY > 0) {
        startY.current = null;
        tracking.current = false;
        return;
      }
      const t = e.touches[0];
      if (!t) return;
      startY.current = t.clientY;
      tracking.current = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking.current || startY.current === null) return;
      const t = e.touches[0];
      if (!t) return;
      const dy = t.clientY - startY.current;
      const next = dy <= 0 ? 0 : Math.min(dy / resistance, threshold * 1.5);
      pullRef.current = next;
      setPull(next);
    };

    const onTouchEnd = () => {
      if (!tracking.current) return;
      tracking.current = false;
      startY.current = null;
      if (pullRef.current < threshold || refreshingRef.current) {
        pullRef.current = 0;
        setPull(0);
        return;
      }
      refreshingRef.current = true;
      setRefreshing(true);
      Promise.resolve(onRefresh()).finally(() => {
        refreshingRef.current = false;
        pullRef.current = 0;
        setRefreshing(false);
        setPull(0);
      });
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [onRefresh, threshold, resistance]);

  return { pull, refreshing };
}
