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
      if (dy <= 0) {
        setPull(0);
        return;
      }
      const damped = dy / resistance;
      setPull(Math.min(damped, threshold * 1.5));
    };

    const onTouchEnd = () => {
      if (!tracking.current) return;
      tracking.current = false;
      startY.current = null;
      setPull((current) => {
        if (current >= threshold && !refreshing) {
          setRefreshing(true);
          Promise.resolve(onRefresh()).finally(() => {
            setRefreshing(false);
            setPull(0);
          });
        } else {
          return 0;
        }
        return current;
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
  }, [onRefresh, threshold, resistance, refreshing]);

  return { pull, refreshing };
}
