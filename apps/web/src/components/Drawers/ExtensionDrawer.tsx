import { useMemo, useState } from "react";
import { addDays, formatISO } from "date-fns";

import { formatDateInput, fromIndianapolis, toIndianapolis } from "../../lib/dates";
import { useExtension } from "../../hooks/useExtension";
import { Drawer } from "./Drawer";

type ExtensionChip = {
  id: string;
  label: string;
  addDays: number;
};

const CHIPS: ExtensionChip[] = [
  { id: "plus-3", label: "+3 days", addDays: 3 },
  { id: "plus-7", label: "+1 week", addDays: 7 },
  { id: "plus-14", label: "+2 weeks", addDays: 14 },
];

type Props = {
  open: boolean;
  onClose: () => void;
  loanId: string;
  currentReturnAtUtc: string;
  onExtended: (newReturnAtUtc: string) => void;
};

export function ExtensionDrawer({
  open,
  onClose,
  loanId,
  currentReturnAtUtc,
  onExtended,
}: Props): JSX.Element {
  const [chipId, setChipId] = useState<string>(CHIPS[0]!.id);
  const [customDate, setCustomDate] = useState<string>("");
  const extension = useExtension();

  const newReturnUtc = useMemo(() => {
    if (customDate) {
      return fromIndianapolis(toIndianapolis(`${customDate}T20:00:00Z`));
    }
    const chip = CHIPS.find((c) => c.id === chipId) ?? CHIPS[0]!;
    return formatISO(addDays(new Date(currentReturnAtUtc), chip.addDays));
  }, [chipId, customDate, currentReturnAtUtc]);

  function handleConfirm(): void {
    extension.mutate(
      { loanId, newReturnAtUtc: newReturnUtc },
      {
        onSuccess: () => {
          onExtended(newReturnUtc);
          onClose();
        },
      },
    );
  }

  return (
    <Drawer open={open} onClose={onClose} title="Need it longer?" testid="extension-drawer">
      <div className="space-y-4">
        <p className="text-sm opacity-80">No approval needed. We&apos;ll let Dad know.</p>
        <div className="flex flex-wrap gap-2" data-testid="extension-chips">
          {CHIPS.map((c) => {
            const selected = chipId === c.id && !customDate;
            return (
              <button
                type="button"
                key={c.id}
                onClick={() => {
                  setChipId(c.id);
                  setCustomDate("");
                }}
                aria-pressed={selected}
                className={`rounded-full px-3 py-1.5 text-sm border ${
                  selected
                    ? "bg-gold-bright text-workshop border-gold-bright"
                    : "border-workshop/20 dark:border-surface-light/20"
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        <label className="block text-sm">
          <span className="opacity-70">Or pick a date:</span>
          <input
            type="date"
            value={customDate}
            onChange={(e) => setCustomDate(e.target.value)}
            className="mt-1 block w-full rounded-xl border border-workshop/20 dark:border-surface-light/20 bg-transparent px-3 py-2"
          />
        </label>
        <p className="text-xs opacity-70">
          New target return: <span className="font-semibold">{formatDateInput(newReturnUtc)}</span>
        </p>
        {extension.isError ? (
          <p
            role="alert"
            className="rounded-lg border border-status-overdue/40 bg-status-overdue/10 p-3 text-sm"
          >
            Couldn&apos;t extend. Try again.
          </p>
        ) : null}
        <button
          type="button"
          onClick={handleConfirm}
          disabled={extension.isPending}
          className="block w-full rounded-2xl bg-gold-bright px-5 py-4 font-semibold text-workshop disabled:opacity-60"
        >
          {extension.isPending ? "Extending…" : "Extend"}
        </button>
      </div>
    </Drawer>
  );
}
