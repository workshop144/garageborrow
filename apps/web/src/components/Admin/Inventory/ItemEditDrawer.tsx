import { useEffect, useState } from "react";
import type { TierName } from "@garageborrow/shared";

import { Drawer } from "../../Drawers/Drawer";
import type { AdminItem, ItemPatchBody } from "../../../hooks/useAdminItems";
import {
  useCreateAdminItem,
  useRetireAdminItem,
  useUpdateAdminItem,
} from "../../../hooks/useAdminItems";
import { uploadPhoto } from "../../../lib/uploadPhoto";

type Props = {
  open: boolean;
  onClose: () => void;
  item: AdminItem | null;
  knownCategories: string[];
};

const TIERS: TierName[] = ["howdy", "friend", "family"];

// Tags input — comma- or pipe-separated chips. Backspace on an empty input
// removes the trailing chip.
function TagsInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}): JSX.Element {
  const [draft, setDraft] = useState("");
  function commit(): void {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (value.includes(trimmed)) {
      setDraft("");
      return;
    }
    onChange([...value, trimmed]);
    setDraft("");
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-workshop/15 dark:border-surface-light/15 p-2">
      {value.map((t) => (
        <span
          key={t}
          className="flex items-center gap-1 rounded-full bg-workshop/5 dark:bg-surface-light/5 px-2 py-0.5 text-xs"
        >
          {t}
          <button
            type="button"
            aria-label={`Remove ${t}`}
            onClick={() => onChange(value.filter((x) => x !== t))}
            className="opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder="Add tag…"
        className="flex-1 min-w-[6rem] bg-transparent text-sm outline-none"
      />
    </div>
  );
}

export function ItemEditDrawer({ open, onClose, item, knownCategories }: Props): JSX.Element {
  const [draft, setDraft] = useState<ItemPatchBody>({});
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(
      item
        ? {
            name: item.name,
            description: item.description,
            category: item.category,
            primary_photo_key: item.primary_photo_key,
            handling_notes: item.handling_notes ?? "",
            default_duration_days: item.default_duration_days,
            requires_approval: item.requires_approval,
            min_tier: item.min_tier,
            auto_approve_tier: item.auto_approve_tier,
            approx_value: item.approx_value,
            tags: item.tags,
          }
        : { default_duration_days: 3, min_tier: "howdy", auto_approve_tier: "family", tags: [] },
    );
  }, [open, item]);

  const updateMut = useUpdateAdminItem();
  const createMut = useCreateAdminItem();
  const retireMut = useRetireAdminItem();
  const isSaving = updateMut.isPending || createMut.isPending;

  async function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError(null);
    setPhotoUploading(true);
    try {
      const { key } = await uploadPhoto(file, "tool_photo");
      setDraft((d) => ({ ...d, primary_photo_key: key }));
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setPhotoUploading(false);
    }
  }

  async function submit(): Promise<void> {
    if (!draft.name || !draft.category) return;
    if (item) {
      await updateMut.mutateAsync({ itemId: item.id, body: draft });
    } else {
      await createMut.mutateAsync(draft);
    }
    onClose();
  }

  async function retire(): Promise<void> {
    if (!item) return;
    await retireMut.mutateAsync({ itemId: item.id });
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={item ? "Edit tool" : "Add a tool"}
      testid="item-edit-drawer"
    >
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="font-semibold">Photo</span>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => void onPhotoChange(e)}
            className="mt-1 block w-full"
          />
          {photoUploading ? <p className="text-xs opacity-70">Uploading…</p> : null}
          {photoError ? <p className="text-xs text-status-overdue">{photoError}</p> : null}
          {draft.primary_photo_key ? (
            <p className="mt-1 text-xs opacity-70">Key: {draft.primary_photo_key}</p>
          ) : null}
        </label>

        <label className="block">
          <span className="font-semibold">Name</span>
          <input
            value={draft.name ?? ""}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
          />
        </label>

        <label className="block">
          <span className="font-semibold">Description</span>
          <textarea
            value={draft.description ?? ""}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            rows={2}
            className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
          />
        </label>

        <label className="block">
          <span className="font-semibold">Category</span>
          <input
            value={draft.category ?? ""}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            list="admin-item-categories"
            className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
          />
          <datalist id="admin-item-categories">
            {knownCategories.map((c) => (
              <option value={c} key={c} />
            ))}
          </datalist>
        </label>

        <label className="block">
          <span className="font-semibold">Handling notes</span>
          <textarea
            value={draft.handling_notes ?? ""}
            onChange={(e) => setDraft({ ...draft, handling_notes: e.target.value })}
            rows={2}
            className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="font-semibold">Default duration (days)</span>
            <input
              type="number"
              min={1}
              value={draft.default_duration_days ?? 3}
              onChange={(e) =>
                setDraft({ ...draft, default_duration_days: Number(e.target.value) })
              }
              className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
            />
          </label>
          <label className="block">
            <span className="font-semibold">Approx value ($)</span>
            <input
              type="number"
              min={0}
              value={draft.approx_value ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  approx_value: e.target.value === "" ? undefined : Number(e.target.value),
                })
              }
              className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
            />
          </label>
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.requires_approval ?? false}
            onChange={(e) => setDraft({ ...draft, requires_approval: e.target.checked })}
          />
          <span>Requires approval</span>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="font-semibold">Min tier</span>
            <select
              value={draft.min_tier ?? "howdy"}
              onChange={(e) => setDraft({ ...draft, min_tier: e.target.value as TierName })}
              className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
            >
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="font-semibold">Auto-approve tier</span>
            <select
              value={draft.auto_approve_tier ?? "family"}
              onChange={(e) =>
                setDraft({ ...draft, auto_approve_tier: e.target.value as TierName })
              }
              className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
            >
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="font-semibold">Tags</span>
          <div className="mt-1">
            <TagsInput
              value={draft.tags ?? []}
              onChange={(next) => setDraft({ ...draft, tags: next })}
            />
          </div>
        </label>

        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={isSaving}
            className="rounded-xl bg-gold-bright px-4 py-2 font-semibold text-workshop disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-workshop/15 dark:border-surface-light/15 px-4 py-2"
          >
            Cancel
          </button>
          {item ? (
            <button
              type="button"
              onClick={() => void retire()}
              disabled={retireMut.isPending}
              className="ml-auto rounded-xl border border-status-overdue/40 px-4 py-2 text-status-overdue disabled:opacity-50"
            >
              {retireMut.isPending ? "Retiring…" : "Retire item"}
            </button>
          ) : null}
        </div>
      </div>
    </Drawer>
  );
}
