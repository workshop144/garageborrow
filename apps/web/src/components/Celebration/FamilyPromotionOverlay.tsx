import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const STORAGE_KEY = "gb.family-celebration.seen";

type Props = {
  userKey: string;
  shouldCelebrate: boolean;
  onDismiss?: () => void;
};

export function celebrationStorageKey(userKey: string): string {
  return `${STORAGE_KEY}:${userKey}`;
}

export function hasSeenCelebration(userKey: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(celebrationStorageKey(userKey)) === "1";
  } catch {
    return true;
  }
}

export function markCelebrationSeen(userKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(celebrationStorageKey(userKey), "1");
  } catch {
    // ignore quota / privacy mode failures
  }
}

export function FamilyPromotionOverlay({
  userKey,
  shouldCelebrate,
  onDismiss,
}: Props): JSX.Element | null {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!shouldCelebrate || !userKey) return;
    if (hasSeenCelebration(userKey)) return;
    setOpen(true);
    void launchConfetti();
  }, [shouldCelebrate, userKey]);

  function dismiss(): void {
    markCelebrationSeen(userKey);
    setOpen(false);
    onDismiss?.();
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          data-testid="family-celebration"
          className="fixed inset-0 z-50 flex items-center justify-center bg-workshop/80 px-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            initial={{ y: 20, scale: 0.95, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 22 }}
            className="max-w-md rounded-3xl bg-surface-light dark:bg-workshop p-8 text-center shadow-2xl"
          >
            <p className="font-heading text-4xl text-gold-bright">Dad just gave you the keys.</p>
            <p className="mt-3 text-base opacity-90">
              Anything in the garage is yours to grab whenever.
            </p>
            <button
              type="button"
              onClick={dismiss}
              data-testid="family-celebration-dismiss"
              className="mt-6 rounded-2xl bg-gold-bright px-6 py-3 font-semibold text-workshop"
            >
              Got it
            </button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

async function launchConfetti(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const mod = await import("canvas-confetti");
    const confetti = (mod as { default: (opts?: Record<string, unknown>) => void }).default;
    confetti({ particleCount: 120, spread: 80, origin: { y: 0.4 } });
    setTimeout(() => confetti({ particleCount: 80, spread: 100, origin: { y: 0.5 } }), 300);
  } catch {
    // canvas-confetti is best-effort; ignore failures (test env, etc.)
  }
}
