import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/idempotency";
import { uploadPhoto } from "../../lib/uploadPhoto";
import { DEFAULT_GARAGE_SLUG } from "../../hooks/useGarageItems";
import type { WishlistRow } from "../../hooks/useWishlist";

const STEPS = ["name", "when", "why", "reference", "photo", "confirm"] as const;
type Step = (typeof STEPS)[number];

const STEP_LABELS: Record<Step, string> = {
  name: "Name",
  when: "When",
  why: "Why",
  reference: "Link",
  photo: "Photo",
  confirm: "Confirm",
};

type Draft = {
  itemName: string;
  description: string;
  desiredBy: string;
  reason: string;
  referenceUrl: string;
  photoFile: File | null;
};

const EMPTY: Draft = {
  itemName: "",
  description: "",
  desiredBy: "",
  reason: "",
  referenceUrl: "",
  photoFile: null,
};

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: (req: WishlistRow) => void;
  garageSlug?: string;
  initialName?: string;
};

export function RequestModal({
  open,
  onClose,
  onCreated,
  garageSlug = DEFAULT_GARAGE_SLUG,
  initialName,
}: Props): JSX.Element | null {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("name");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const idemKeyRef = useRef<string>(newIdempotencyKey());

  useEffect(() => {
    if (open) {
      setDraft({ ...EMPTY, itemName: initialName ?? "" });
      setStep("name");
      idemKeyRef.current = newIdempotencyKey();
    }
  }, [open, initialName]);

  const submit = useMutation<WishlistRow, Error, void>({
    mutationFn: async () => {
      const body: Record<string, unknown> = { item_name: draft.itemName.trim() };
      if (draft.description.trim()) body["description"] = draft.description.trim();
      if (draft.desiredBy.trim()) body["desired_by"] = draft.desiredBy.trim();
      if (draft.reason.trim()) body["reason"] = draft.reason.trim();
      if (draft.referenceUrl.trim()) body["reference_url"] = draft.referenceUrl.trim();
      if (draft.photoFile) {
        const { key } = await uploadPhoto(draft.photoFile, "wishlist_photo");
        body["photo_url"] = key;
      }
      const r = await api.post<{ request: WishlistRow }>(
        `/g/${encodeURIComponent(garageSlug)}/wishlist`,
        body,
        { idempotencyKey: idemKeyRef.current },
      );
      return r.request;
    },
    onSuccess: (req) => {
      void qc.invalidateQueries({ queryKey: ["wishlist", garageSlug] });
      onCreated?.(req);
      onClose();
    },
  });

  if (!open) return null;

  const stepIdx = STEPS.indexOf(step);
  const isFirst = stepIdx === 0;
  const isLast = step === "confirm";

  function next() {
    if (step === "name" && !draft.itemName.trim()) return;
    setStep(STEPS[Math.min(stepIdx + 1, STEPS.length - 1)] as Step);
  }
  function back() {
    setStep(STEPS[Math.max(stepIdx - 1, 0)] as Step);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Request something new"
      data-testid="wishlist-request-modal"
      className="fixed inset-0 z-50 flex items-end justify-center bg-workshop/60 sm:items-center"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div className="relative w-full max-w-lg rounded-t-3xl bg-surface-light p-4 dark:bg-workshop sm:rounded-3xl">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-2xl text-gold-bright">Request something new</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-2 opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </header>

        <ol
          className="mb-4 flex items-center gap-1 text-[10px] uppercase tracking-wide"
          data-testid="wishlist-stepper"
        >
          {STEPS.map((s, i) => {
            const active = i === stepIdx;
            const done = i < stepIdx;
            return (
              <li
                key={s}
                className={`flex-1 rounded-md px-1 py-1 text-center ${
                  active
                    ? "bg-gold-bright text-workshop font-semibold"
                    : done
                      ? "bg-workshop/10 dark:bg-surface-light/10"
                      : "opacity-50"
                }`}
              >
                {STEP_LABELS[s]}
              </li>
            );
          })}
        </ol>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (isLast) submit.mutate();
            else next();
          }}
        >
          {step === "name" ? (
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="block font-semibold">Item name</span>
                <input
                  type="text"
                  value={draft.itemName}
                  onChange={(e) => setDraft((d) => ({ ...d, itemName: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
                  placeholder="e.g. log splitter"
                  required
                  data-testid="wishlist-name-input"
                  maxLength={120}
                />
              </label>
              <label className="block text-sm">
                <span className="block font-semibold">Quick description (optional)</span>
                <textarea
                  value={draft.description}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  rows={3}
                  className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
                  placeholder="What kind, what for, anything specific."
                  data-testid="wishlist-description-input"
                  maxLength={1000}
                />
              </label>
            </div>
          ) : null}

          {step === "when" ? (
            <label className="block text-sm">
              <span className="block font-semibold">When do you need it? (optional)</span>
              <input
                type="date"
                value={draft.desiredBy}
                onChange={(e) => setDraft((d) => ({ ...d, desiredBy: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
                data-testid="wishlist-desired-by-input"
              />
              <span className="mt-1 block text-xs opacity-70">
                No rush is fine — leave it blank.
              </span>
            </label>
          ) : null}

          {step === "why" ? (
            <label className="block text-sm">
              <span className="block font-semibold">Why? (optional)</span>
              <textarea
                value={draft.reason}
                onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))}
                rows={4}
                className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
                placeholder="Helps Dad prioritize."
                data-testid="wishlist-reason-input"
                maxLength={500}
              />
            </label>
          ) : null}

          {step === "reference" ? (
            <label className="block text-sm">
              <span className="block font-semibold">Reference link (optional)</span>
              <input
                type="url"
                value={draft.referenceUrl}
                onChange={(e) => setDraft((d) => ({ ...d, referenceUrl: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
                placeholder="https://www.amazon.com/..."
                data-testid="wishlist-reference-input"
              />
            </label>
          ) : null}

          {step === "photo" ? (
            <label className="block text-sm">
              <span className="block font-semibold">Photo (optional)</span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) =>
                  setDraft((d) => ({ ...d, photoFile: e.target.files?.[0] ?? null }))
                }
                className="mt-1 w-full text-sm"
                data-testid="wishlist-photo-input"
              />
              {draft.photoFile ? (
                <span className="mt-1 block text-xs opacity-70">
                  Selected: {draft.photoFile.name}
                </span>
              ) : null}
            </label>
          ) : null}

          {step === "confirm" ? (
            <div className="space-y-2 rounded-xl border border-workshop/15 dark:border-surface-light/15 p-3 text-sm">
              <p>
                <span className="font-semibold">Item:</span> {draft.itemName}
              </p>
              {draft.description ? (
                <p>
                  <span className="font-semibold">About:</span> {draft.description}
                </p>
              ) : null}
              {draft.desiredBy ? (
                <p>
                  <span className="font-semibold">By:</span> {draft.desiredBy}
                </p>
              ) : null}
              {draft.reason ? (
                <p>
                  <span className="font-semibold">Why:</span> {draft.reason}
                </p>
              ) : null}
              {draft.referenceUrl ? (
                <p className="break-all">
                  <span className="font-semibold">Link:</span> {draft.referenceUrl}
                </p>
              ) : null}
              {draft.photoFile ? (
                <p>
                  <span className="font-semibold">Photo:</span> {draft.photoFile.name}
                </p>
              ) : null}
            </div>
          ) : null}

          {submit.error ? (
            <p
              className="rounded-xl border border-status-overdue/40 bg-status-overdue/10 p-3 text-sm"
              data-testid="wishlist-submit-error"
            >
              Something went wrong — {submit.error.message}
            </p>
          ) : null}

          <div className="flex justify-between gap-2">
            <button
              type="button"
              onClick={back}
              disabled={isFirst || submit.isPending}
              className="rounded-xl border border-workshop/15 dark:border-surface-light/15 px-3 py-2 text-sm disabled:opacity-40"
              data-testid="wishlist-back"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={submit.isPending || (step === "name" && !draft.itemName.trim())}
              className="rounded-xl bg-gold-bright px-4 py-2 text-sm font-semibold text-workshop disabled:opacity-50"
              data-testid={isLast ? "wishlist-submit" : "wishlist-next"}
            >
              {isLast ? (submit.isPending ? "Sending…" : "Add to wishlist") : "Next"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
