import { useCallback, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DonationCondition, DonationOffer } from "@garageborrow/shared";

import { api } from "../lib/api";
import { newIdempotencyKey } from "../lib/idempotency";
import { uploadPhoto } from "../lib/uploadPhoto";
import { DEFAULT_GARAGE_SLUG } from "./useGarageItems";
import { myDonationsQueryKey } from "./useMyDonations";

export const DONATE_STEP_ORDER = [
  "name",
  "photos",
  "condition",
  "notes",
  "category",
  "confirm",
] as const;
export type DonateStep = (typeof DONATE_STEP_ORDER)[number];

export const MIN_PHOTOS = 1;
export const MAX_PHOTOS = 3;

export type DonateDraftPhoto = {
  // Local object URL for preview. Revoked when the photo is removed.
  previewUrl: string;
  // Cropped square Blob, ready to upload. Replaced when the user re-crops.
  blob: Blob;
  // Resolved S3 key once the upload completes (set by submit, not by add).
  key?: string;
};

export type DonateDraft = {
  itemName: string;
  description: string;
  photos: DonateDraftPhoto[];
  condition: DonationCondition | null;
  notes: string;
  suggestedCategory: string;
};

const EMPTY_DRAFT: DonateDraft = {
  itemName: "",
  description: "",
  photos: [],
  condition: null,
  notes: "",
  suggestedCategory: "",
};

export function isStepComplete(step: DonateStep, draft: DonateDraft): boolean {
  switch (step) {
    case "name":
      return draft.itemName.trim().length > 0;
    case "photos":
      return draft.photos.length >= MIN_PHOTOS && draft.photos.length <= MAX_PHOTOS;
    case "condition":
      return draft.condition !== null;
    case "notes":
      return true;
    case "category":
      return true;
    case "confirm":
      return (
        draft.itemName.trim().length > 0 &&
        draft.photos.length >= MIN_PHOTOS &&
        draft.condition !== null
      );
  }
}

type CreateDonationVars = {
  draft: DonateDraft;
  idempotencyKey: string;
};

type CreateDonationResponse = { donation: DonationOffer };

export function useDonate(garageSlug: string = DEFAULT_GARAGE_SLUG) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<DonateDraft>(EMPTY_DRAFT);
  const [step, setStep] = useState<DonateStep>("name");
  // A fresh idempotency key per "attempt" — each time the user lands on the
  // confirm screen we mint one and reuse it across transient retries. After a
  // successful submit we clear the form, which mints a new one next attempt.
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => newIdempotencyKey());
  const [submittedDonation, setSubmittedDonation] = useState<DonationOffer | null>(null);

  const submit = useMutation<DonationOffer, Error, CreateDonationVars>({
    mutationFn: async ({ draft: d, idempotencyKey: key }) => {
      // Upload photos first; if any fail the whole submit fails before the
      // POST so the server never sees a half-finished donation.
      const photoKeys: string[] = [];
      for (const p of d.photos) {
        if (p.key) {
          photoKeys.push(p.key);
          continue;
        }
        const file = new File([p.blob], "photo.jpg", { type: p.blob.type || "image/jpeg" });
        const { key: k } = await uploadPhoto(file, "donation_photo");
        photoKeys.push(k);
      }
      const condition = d.condition;
      if (!condition) throw new Error("Condition required");
      const body: Record<string, unknown> = {
        item_name: d.itemName.trim(),
        description: d.description.trim(),
        photo_keys: photoKeys,
        condition,
      };
      if (d.notes.trim()) body["donor_notes"] = d.notes.trim();
      if (d.suggestedCategory.trim()) body["suggested_category"] = d.suggestedCategory.trim();
      const r = await api.post<CreateDonationResponse>(
        `/g/${encodeURIComponent(garageSlug)}/donations`,
        body,
        { idempotencyKey: key },
      );
      return r.donation;
    },
    onSuccess: (donation) => {
      setSubmittedDonation(donation);
      void qc.invalidateQueries({ queryKey: myDonationsQueryKey() });
    },
  });

  const goNext = useCallback(() => {
    setStep((s) => {
      const idx = DONATE_STEP_ORDER.indexOf(s);
      if (idx < 0 || idx === DONATE_STEP_ORDER.length - 1) return s;
      return DONATE_STEP_ORDER[idx + 1] as DonateStep;
    });
  }, []);

  const goBack = useCallback(() => {
    setStep((s) => {
      const idx = DONATE_STEP_ORDER.indexOf(s);
      if (idx <= 0) return s;
      return DONATE_STEP_ORDER[idx - 1] as DonateStep;
    });
  }, []);

  const reset = useCallback(() => {
    for (const p of draft.photos) {
      try {
        URL.revokeObjectURL(p.previewUrl);
      } catch {
        /* ignore */
      }
    }
    setDraft(EMPTY_DRAFT);
    setStep("name");
    setSubmittedDonation(null);
    setIdempotencyKey(newIdempotencyKey());
  }, [draft.photos]);

  const setField = useCallback(<K extends keyof DonateDraft>(key: K, value: DonateDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  }, []);

  const submitNow = useCallback(() => {
    submit.mutate({ draft, idempotencyKey });
  }, [draft, idempotencyKey, submit]);

  const canAdvance = useMemo(() => isStepComplete(step, draft), [step, draft]);

  return {
    step,
    draft,
    setField,
    setDraft,
    goNext,
    goBack,
    canAdvance,
    submit: submitNow,
    submitting: submit.isPending,
    submitError: submit.error,
    submittedDonation,
    reset,
  };
}
