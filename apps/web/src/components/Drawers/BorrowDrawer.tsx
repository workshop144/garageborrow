import { useEffect, useMemo, useState } from "react";
import { addDays, formatISO, nextSaturday } from "date-fns";
import type { Instance, ItemDetail } from "@garageborrow/shared";

import {
  formatDateInput,
  formatInAppZone,
  fromIndianapolis,
  toIndianapolis,
} from "../../lib/dates";
import { liabilityCopyFor, resolveLiabilityTier, type LiabilityTier } from "../../lib/borrow-copy";
import { ApiError } from "../../lib/api";
import type { BorrowSuccess } from "../../hooks/useBorrow";
import { useBorrow } from "../../hooks/useBorrow";
import { Drawer } from "./Drawer";
import { LiabilityCallout } from "./LiabilityCallout";
import { ReservationConflict } from "./ReservationConflict";
import type { InstanceUnavailableDetails } from "./ReservationConflict";

export type BorrowMode = "instant" | "request";

const COPY_VERSION = "v1";

export type DateChip = {
  id: string;
  label: string;
  computeDate: (now: Date) => Date;
  durationDaysFromNow: (now: Date) => number;
};

export const DATE_CHIPS: DateChip[] = [
  {
    id: "today",
    label: "Today",
    computeDate: (now) => endOfDayLocal(now),
    durationDaysFromNow: () => 1,
  },
  {
    id: "this-weekend",
    label: "This weekend",
    computeDate: (now) => endOfDayLocal(thisOrNextSaturday(now)),
    durationDaysFromNow: (now) => daysBetween(now, thisOrNextSaturday(now)),
  },
  {
    id: "next-weekend",
    label: "Next weekend",
    computeDate: (now) => endOfDayLocal(nextSaturday(thisOrNextSaturday(now))),
    durationDaysFromNow: (now) => daysBetween(now, nextSaturday(thisOrNextSaturday(now))),
  },
  {
    id: "one-week",
    label: "In a week",
    computeDate: (now) => addDays(now, 7),
    durationDaysFromNow: () => 7,
  },
  {
    id: "two-weeks",
    label: "In two weeks",
    computeDate: (now) => addDays(now, 14),
    durationDaysFromNow: () => 14,
  },
];

function endOfDayLocal(d: Date): Date {
  const out = new Date(d);
  out.setHours(20, 0, 0, 0);
  return out;
}

function thisOrNextSaturday(now: Date): Date {
  // If today is Sat/Sun, return today; else next Saturday.
  const dow = now.getDay();
  if (dow === 6 || dow === 0) return now;
  return nextSaturday(now);
}

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.max(1, Math.round(ms / 86400000));
}

export function pickDefaultChip(defaultDurationDays: number, now: Date = new Date()): DateChip {
  let best = DATE_CHIPS[0]!;
  let bestDelta = Infinity;
  for (const chip of DATE_CHIPS) {
    const delta = Math.abs(chip.durationDaysFromNow(now) - defaultDurationDays);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = chip;
    }
  }
  return best;
}

type Step = "instance" | "date" | "note" | "liability";

type Props = {
  open: boolean;
  onClose: () => void;
  item: ItemDetail;
  instances: Instance[];
  mode: BorrowMode;
  onSuccess: (result: BorrowSuccess) => void;
};

export function BorrowDrawer({
  open,
  onClose,
  item,
  instances,
  mode,
  onSuccess,
}: Props): JSX.Element {
  const availableInstances = useMemo(
    () => instances.filter((i) => i.status === "available"),
    [instances],
  );
  const onlyOne = availableInstances.length <= 1;

  const initialStep: Step = onlyOne ? "date" : "instance";
  const [step, setStep] = useState<Step>(initialStep);
  const [instanceId, setInstanceId] = useState<string | null>(
    onlyOne && availableInstances[0] ? availableInstances[0].id : null,
  );
  const defaultChip = useMemo(
    () => pickDefaultChip(item.default_duration_days),
    [item.default_duration_days],
  );
  const [chipId, setChipId] = useState<string>(defaultChip.id);
  const [customDate, setCustomDate] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [conflict, setConflict] = useState<InstanceUnavailableDetails | null>(null);

  const tier: LiabilityTier = useMemo(() => resolveLiabilityTier(item.tags), [item.tags]);
  const copy = useMemo(() => liabilityCopyFor(item.tags), [item.tags]);
  const borrow = useBorrow();
  const borrowReset = borrow.reset;

  // Reset state whenever the drawer opens for a new item.
  useEffect(() => {
    if (open) {
      setStep(initialStep);
      setInstanceId(onlyOne && availableInstances[0] ? availableInstances[0].id : null);
      setChipId(defaultChip.id);
      setCustomDate("");
      setNote("");
      setConflict(null);
      borrowReset();
    }
    // borrowReset is stable across renders for a given mutation; dep on it is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialStep, onlyOne, defaultChip.id]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [open]);

  const chip = DATE_CHIPS.find((c) => c.id === chipId) ?? defaultChip;
  const customDateUtc = customDate
    ? fromIndianapolis(toIndianapolis(`${customDate}T20:00:00Z`))
    : null;
  const targetReturnUtc = customDateUtc ?? formatISO(chip.computeDate(now));
  const durationDays = customDateUtc
    ? daysBetween(now, new Date(customDateUtc))
    : chip.durationDaysFromNow(now);

  const confirmLabel = mode === "request" ? "Send request to Dad" : "Take it home";

  function handleConfirm(): void {
    const input: Parameters<typeof borrow.mutate>[0] = {
      itemId: item.id,
      durationDays,
      liabilityCopyVersion: COPY_VERSION,
    };
    if (instanceId) input.instanceId = instanceId;
    if (note.trim()) input.note = note.trim();
    borrow.mutate(input, {
      onSuccess: (result) => {
        onSuccess(result);
      },
      onError: (err) => {
        if (err instanceof ApiError && err.status === 409 && err.code === "instance_unavailable") {
          setConflict((err.details as InstanceUnavailableDetails | undefined) ?? {});
        }
      },
    });
  }

  return (
    <Drawer open={open} onClose={onClose} title={item.name} testid="borrow-drawer">
      {conflict ? (
        <ReservationConflict
          details={conflict}
          instances={instances}
          onPickAlternate={(id) => {
            setInstanceId(id);
            setConflict(null);
            setStep("date");
          }}
          onTryNextDate={(iso) => {
            setCustomDate(iso.slice(0, 10));
            setConflict(null);
            setStep("date");
          }}
          onDismiss={() => {
            setConflict(null);
            onClose();
          }}
        />
      ) : (
        <div className="space-y-5">
          {step === "instance" ? (
            <section>
              <p className="text-sm font-semibold mb-2">Pick the one you want</p>
              <ul className="grid grid-cols-1 gap-2">
                {availableInstances.map((inst) => (
                  <li key={inst.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setInstanceId(inst.id);
                        setStep("date");
                      }}
                      className={`w-full rounded-xl border p-3 text-left ${
                        instanceId === inst.id
                          ? "border-gold-bright bg-gold-bright/10"
                          : "border-workshop/15 dark:border-surface-light/15"
                      }`}
                    >
                      <span className="font-semibold">{inst.label}</span>
                      <span className="ml-2 text-xs uppercase opacity-70">{inst.quality_tier}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {step === "date" ? (
            <section>
              <p className="font-heading text-xl">When do you think you&apos;ll bring it back?</p>
              <div className="mt-3 flex flex-wrap gap-2" data-testid="date-chips">
                {DATE_CHIPS.map((c) => {
                  const selected = chipId === c.id && !customDate;
                  return (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => {
                        setChipId(c.id);
                        setCustomDate("");
                      }}
                      data-chip={c.id}
                      aria-pressed={selected}
                      className={`rounded-full px-3 py-1.5 text-sm border ${
                        selected
                          ? "bg-gold-bright text-workshop border-gold-bright"
                          : "border-workshop/20 dark:border-surface-light/20 hover:border-gold-bright/60"
                      }`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
              <label className="mt-3 block text-sm">
                <span className="opacity-70">Or pick a date:</span>
                <input
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-workshop/20 dark:border-surface-light/20 bg-transparent px-3 py-2"
                />
              </label>
              <p className="mt-2 text-xs italic opacity-70">Just a guess. Easy to extend later.</p>
              <p className="mt-1 text-xs opacity-70">
                Target return:{" "}
                <span className="font-semibold">
                  {formatDateInput(targetReturnUtc)} at {formatInAppZone(targetReturnUtc, "h:mm a")}
                </span>
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setStep("note")}
                  className="rounded-xl bg-gold-accent px-4 py-2 font-semibold text-workshop"
                >
                  Next
                </button>
              </div>
            </section>
          ) : null}

          {step === "note" ? (
            <section>
              <p className="font-heading text-xl">Anything to tell Dad? (optional)</p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 200))}
                maxLength={200}
                rows={3}
                placeholder="e.g. picking it up Saturday morning"
                className="mt-2 block w-full rounded-xl border border-workshop/20 dark:border-surface-light/20 bg-transparent px-3 py-2"
              />
              <p className="mt-1 text-xs opacity-60">{note.length}/200</p>
              <div className="mt-4 flex justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setStep("date")}
                  className="rounded-xl border border-workshop/20 dark:border-surface-light/20 px-4 py-2 text-sm"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep("liability")}
                  className="rounded-xl bg-gold-accent px-4 py-2 font-semibold text-workshop"
                >
                  Next
                </button>
              </div>
            </section>
          ) : null}

          {step === "liability" ? (
            <section className="space-y-4">
              <LiabilityCallout tier={tier} copy={copy} />
              {borrow.isError && !conflict ? (
                <p
                  role="alert"
                  className="rounded-lg border border-status-overdue/40 bg-status-overdue/10 p-3 text-sm"
                >
                  {borrow.error instanceof Error
                    ? borrow.error.message
                    : "Something went wrong. Try again."}
                </p>
              ) : null}
              <button
                type="button"
                onClick={handleConfirm}
                disabled={borrow.isPending}
                data-testid="borrow-confirm"
                className="block w-full rounded-2xl bg-gold-bright px-5 py-4 text-lg font-semibold text-workshop disabled:opacity-60"
              >
                {borrow.isPending ? (mode === "request" ? "Sending…" : "Borrowing…") : confirmLabel}
              </button>
              <button
                type="button"
                onClick={() => setStep("note")}
                className="block w-full rounded-xl border border-workshop/20 dark:border-surface-light/20 px-4 py-2 text-sm"
              >
                Back
              </button>
            </section>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
