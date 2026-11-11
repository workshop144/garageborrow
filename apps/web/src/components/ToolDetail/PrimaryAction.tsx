import type { JSX } from "react";
import type { ItemDetail } from "@garageborrow/shared";

export type PrimaryActionMode = "borrow_instant" | "borrow_request" | "waitlist" | "family_only";

type Props = {
  item: ItemDetail;
  mode: PrimaryActionMode;
  waitlistSize: number;
  onClick: () => void;
  busy?: boolean;
  /**
   * `sms:` link to the owner, sent by the API only with a family-only item
   * (2026-11-07 review F12: the number is no longer built into the bundle).
   */
  contactHref?: string | null | undefined;
};

export function PrimaryAction({
  item,
  mode,
  waitlistSize,
  onClick,
  busy,
  contactHref,
}: Props): JSX.Element {
  const baseClass =
    "block w-full rounded-2xl px-5 py-4 text-center text-lg font-semibold shadow-[0_4px_12px_-4px_rgba(0,0,0,0.25)] transition-transform active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed";

  if (mode === "family_only") {
    if (!contactHref?.startsWith("sms:")) {
      return (
        <p className={`${baseClass} bg-tier-howdy text-workshop`} role="note">
          Family only — ask the owner about {item.name}
        </p>
      );
    }
    return (
      <a
        href={contactHref}
        aria-label={`Text Dad about ${item.name}`}
        className={`${baseClass} bg-tier-howdy text-workshop`}
      >
        Family only — text Dad
      </a>
    );
  }

  if (mode === "waitlist") {
    const positionLine = waitlistSize > 0 ? ` (#${waitlistSize + 1} in line)` : "";
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className={`${baseClass} bg-workshop text-surface-light dark:bg-surface-light dark:text-workshop`}
      >
        {busy ? "Joining…" : `Join waitlist${positionLine}`}
      </button>
    );
  }

  if (mode === "borrow_request") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className={`${baseClass} bg-gold-accent text-workshop`}
      >
        {busy ? "Sending…" : "Request to borrow"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`${baseClass} bg-gold-bright text-workshop`}
    >
      {busy ? "Borrowing…" : "Borrow it"}
    </button>
  );
}
