import { useEffect, useState } from "react";
import type { Garage, NonprofitOrg, TierLabels, TierName } from "@garageborrow/shared";

import {
  useGarage,
  useUpdateGarageSettings,
  type GarageSettingsPatch,
} from "../../../hooks/useGarageSettings";

const TIERS: TierName[] = ["howdy", "friend", "family"];

type Draft = {
  name: string;
  status: Garage["status"];
  closed_until_date: string;
  tier_labels: TierLabels;
  quality_tiers: string[];
  payforward_orgs: NonprofitOrg[];
  payforward_intro_copy: string;
  vouching_required: boolean;
  ai_enabled: boolean;
  ai_min_tier: TierName;
  ai_default_user_monthly_tokens: number;
  ai_total_monthly_cap_cents: number;
  ai_default_model: "haiku" | "sonnet";
};

function fromGarage(g: Garage): Draft {
  return {
    name: g.name,
    status: g.status,
    closed_until_date: g.closed_until_date ?? "",
    tier_labels: g.tier_labels,
    quality_tiers: g.quality_tiers,
    payforward_orgs: g.payforward_orgs,
    payforward_intro_copy: g.payforward_intro_copy ?? "",
    vouching_required: g.vouching_required,
    ai_enabled: g.ai_enabled,
    ai_min_tier: g.ai_min_tier,
    ai_default_user_monthly_tokens: g.ai_default_user_monthly_tokens,
    ai_total_monthly_cap_cents: g.ai_total_monthly_cap_cents,
    ai_default_model: g.ai_default_model,
  };
}

export function SettingsForm(): JSX.Element {
  const garage = useGarage();
  const update = useUpdateGarageSettings();
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (garage.data?.garage) setDraft(fromGarage(garage.data.garage));
  }, [garage.data]);

  if (garage.isLoading || !draft) return <p className="opacity-70">Loading…</p>;
  if (garage.isError) return <p className="text-status-overdue">Couldn&apos;t load settings.</p>;

  function update_field<K extends keyof Draft>(k: K, v: Draft[K]): void {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  }

  async function save(): Promise<void> {
    if (!draft) return;
    const patch: GarageSettingsPatch = {
      name: draft.name,
      status: draft.status,
      ...(draft.closed_until_date ? { closed_until_date: draft.closed_until_date } : {}),
      tier_labels: draft.tier_labels,
      quality_tiers: draft.quality_tiers,
      payforward_orgs: draft.payforward_orgs,
      payforward_intro_copy: draft.payforward_intro_copy,
      vouching_required: draft.vouching_required,
      ai_enabled: draft.ai_enabled,
      ai_min_tier: draft.ai_min_tier,
      ai_default_user_monthly_tokens: draft.ai_default_user_monthly_tokens,
      ai_total_monthly_cap_cents: draft.ai_total_monthly_cap_cents,
      ai_default_model: draft.ai_default_model,
    };
    await update.mutateAsync(patch);
  }

  return (
    <div className="space-y-6 text-sm">
      <section>
        <h2 className="font-heading text-xl">Profile</h2>
        <label className="mt-2 block">
          <span className="font-semibold">Name</span>
          <input
            value={draft.name}
            onChange={(e) => update_field("name", e.target.value)}
            className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
          />
        </label>
        <label className="mt-2 block">
          <span className="font-semibold">Status</span>
          <select
            value={draft.status}
            onChange={(e) => update_field("status", e.target.value as Draft["status"])}
            className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
          >
            <option value="open">Open</option>
            <option value="closed_until">Closed until…</option>
            <option value="closed_indefinitely">Closed indefinitely</option>
          </select>
        </label>
        {draft.status === "closed_until" ? (
          <label className="mt-2 block">
            <span className="font-semibold">Closed until</span>
            <input
              type="date"
              value={draft.closed_until_date}
              onChange={(e) => update_field("closed_until_date", e.target.value)}
              className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
            />
          </label>
        ) : null}
      </section>

      <section>
        <h2 className="font-heading text-xl">Tiers</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {(["howdy", "friend", "family"] as const).map((t) => (
            <label key={t} className="block">
              <span className="font-semibold capitalize">{t} label</span>
              <input
                value={draft.tier_labels[t]}
                onChange={(e) =>
                  update_field("tier_labels", { ...draft.tier_labels, [t]: e.target.value })
                }
                className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
              />
            </label>
          ))}
        </div>
        <label className="mt-2 block">
          <span className="font-semibold">Quality tiers (comma-separated)</span>
          <input
            value={draft.quality_tiers.join(", ")}
            onChange={(e) =>
              update_field(
                "quality_tiers",
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter((s) => s.length > 0),
              )
            }
            className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
          />
        </label>
      </section>

      <section>
        <h2 className="font-heading text-xl">Vouching</h2>
        <label className="mt-2 flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.vouching_required}
            onChange={(e) => update_field("vouching_required", e.target.checked)}
          />
          <span>Vouching required for new members</span>
        </label>
      </section>

      <section>
        <h2 className="font-heading text-xl">Pay it forward</h2>
        <label className="mt-2 block">
          <span className="font-semibold">Intro copy</span>
          <textarea
            value={draft.payforward_intro_copy}
            onChange={(e) => update_field("payforward_intro_copy", e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
          />
        </label>
        <ul className="mt-2 space-y-2">
          {draft.payforward_orgs.map((o, idx) => (
            <li
              key={`${o.name}-${idx}`}
              className="flex items-center gap-2 rounded-xl border border-workshop/15 dark:border-surface-light/15 p-2"
            >
              <input
                value={o.name}
                onChange={(e) => {
                  const next = [...draft.payforward_orgs];
                  next[idx] = { ...o, name: e.target.value };
                  update_field("payforward_orgs", next);
                }}
                className="flex-1 rounded-lg border border-workshop/15 dark:border-surface-light/15 bg-transparent p-1"
              />
              <button
                type="button"
                onClick={() => {
                  const next = draft.payforward_orgs.filter((_, i) => i !== idx);
                  update_field(
                    "payforward_orgs",
                    next.map((n, i) => ({ ...n, display_order: i })),
                  );
                }}
                className="text-xs text-status-overdue underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => {
            const next: NonprofitOrg = {
              name: "New org",
              display_order: draft.payforward_orgs.length,
            };
            update_field("payforward_orgs", [...draft.payforward_orgs, next]);
          }}
          className="mt-2 rounded-xl border border-workshop/15 dark:border-surface-light/15 px-3 py-1 text-xs"
        >
          Add organization
        </button>
      </section>

      <section className="opacity-90">
        <h2 className="font-heading text-xl">AI</h2>
        {!draft.ai_enabled ? (
          <p className="mt-1 rounded-xl border border-gold-bright/40 bg-gold-bright/10 p-2 text-xs">
            Coming soon — keep checking back.
          </p>
        ) : null}
        <label className="mt-2 flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.ai_enabled}
            onChange={(e) => update_field("ai_enabled", e.target.checked)}
          />
          <span>Enable AI</span>
        </label>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="font-semibold">Min tier</span>
            <select
              value={draft.ai_min_tier}
              onChange={(e) => update_field("ai_min_tier", e.target.value as TierName)}
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
            <span className="font-semibold">Default model</span>
            <select
              value={draft.ai_default_model}
              onChange={(e) =>
                update_field("ai_default_model", e.target.value as "haiku" | "sonnet")
              }
              className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
            >
              <option value="haiku">Haiku</option>
              <option value="sonnet">Sonnet</option>
            </select>
          </label>
          <label className="block">
            <span className="font-semibold">Per-user monthly tokens</span>
            <input
              type="number"
              min={0}
              value={draft.ai_default_user_monthly_tokens}
              onChange={(e) =>
                update_field("ai_default_user_monthly_tokens", Number(e.target.value))
              }
              className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
            />
          </label>
          <label className="block">
            <span className="font-semibold">Garage monthly cap (cents)</span>
            <input
              type="number"
              min={0}
              value={draft.ai_total_monthly_cap_cents}
              onChange={(e) => update_field("ai_total_monthly_cap_cents", Number(e.target.value))}
              className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
            />
          </label>
        </div>
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void save()}
          disabled={update.isPending}
          className="rounded-xl bg-gold-bright px-4 py-2 font-semibold text-workshop disabled:opacity-50"
        >
          {update.isPending ? "Saving…" : "Save settings"}
        </button>
      </div>
    </div>
  );
}
