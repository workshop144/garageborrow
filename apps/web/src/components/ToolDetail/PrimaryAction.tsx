import type { ItemDetail } from "@garageborrow/shared";

export type PrimaryActionMode = "borrow_instant" | "borrow_request" | "waitlist" | "family_only";

type Props = {
  item: ItemDetail;
  mode: PrimaryActionMode;
  waitlistSize: number;
  onClick: () => void;
  busy?: boolean;
};

function smsHref(): string {
  const dadPhone = import.meta.env.VITE_DAD_SMS_NUMBER ?? "+15555555555";
  return `sms:${dadPhone}`;
}

export function PrimaryAction({ item, mode, waitlistSize, onClick, busy }: Props): JSX.Element {
  const baseClass =
    "block w-full rounded-2xl px-5 py-4 text-center text-lg font-semibold shadow-[0_4px_12px_-4px_rgba(0,0,0,0.25)] transition-transform active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed";

  if (mode === "family_only") {
    return (
      <a
        href={smsHref()}
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
