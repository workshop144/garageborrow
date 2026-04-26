import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import type { ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  testid?: string;
};

export function Drawer({ open, onClose, title, children, testid }: Props): JSX.Element {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-workshop/60"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            data-testid={testid}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="relative w-full max-w-lg rounded-t-3xl bg-surface-light dark:bg-workshop pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_32px_rgba(0,0,0,0.25)] sm:rounded-3xl"
          >
            <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-workshop/10 dark:border-surface-light/10">
              <h2 className="font-heading text-2xl text-gold-bright">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close drawer"
                className="rounded-full p-2 opacity-70 hover:opacity-100"
              >
                ✕
              </button>
            </div>
            <div className="px-5 py-4 max-h-[80vh] overflow-y-auto">{children}</div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
