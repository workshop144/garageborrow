import { useState } from "react";
import type { TierName } from "@garageborrow/shared";

import { useAdminInvites, useCreateInvite, useRevokeInvite } from "../../../hooks/useAdminMembers";
import { formatAsYouType, toE164 } from "../../../lib/phone";

const TIERS: TierName[] = ["howdy", "friend", "family"];

// Sign-up is invite-only: a neighbor can only create an account after the owner
// adds their number here. Nothing is texted; tell them to sign in with it.
export function InvitesPanel(): JSX.Element {
  const invites = useAdminInvites();
  const create = useCreateInvite();
  const revoke = useRevokeInvite();
  const [phone, setPhone] = useState("");
  const [tier, setTier] = useState<TierName>("howdy");
  const [error, setError] = useState<string | null>(null);

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const e164 = toE164(phone);
    if (!e164) {
      setError("Enter a valid US phone number.");
      return;
    }
    try {
      await create.mutateAsync({ phone: e164, tier });
      setPhone("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the invite.");
    }
  }

  const pending = invites.data?.invites ?? [];

  return (
    <section className="mb-6 rounded-2xl border border-workshop/15 dark:border-surface-light/15 p-4">
      <h2 className="font-heading text-xl">Invite a neighbor</h2>
      <p className="mt-1 text-sm opacity-70">
        Add their number, then tell them to sign in with it. Invites last 14 days.
      </p>
      <form onSubmit={onInvite} className="mt-3 flex flex-wrap gap-2">
        <input
          inputMode="tel"
          placeholder="(317) 555-1234"
          aria-label="Phone to invite"
          value={phone}
          onChange={(e) => setPhone(formatAsYouType(e.target.value))}
          className="flex-1 min-w-[10rem] rounded-md border border-workshop/20 dark:border-surface-light/20 bg-transparent px-3 py-2"
        />
        <select
          aria-label="Starting tier"
          value={tier}
          onChange={(e) => setTier(e.target.value as TierName)}
          className="rounded-md border border-workshop/20 dark:border-surface-light/20 bg-transparent px-2 py-2"
        >
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-md bg-gold-bright px-4 py-2 font-semibold text-workshop disabled:opacity-50"
        >
          Invite
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-status-overdue">{error}</p>}
      {pending.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {pending.map((i) => (
            <li key={i.phone} className="flex items-center justify-between gap-2">
              <span>
                <span className="font-mono">{i.phone}</span>{" "}
                <span className="opacity-70">
                  ({i.tier}, until {new Date(i.expires_at * 1000).toISOString().slice(0, 10)})
                </span>
              </span>
              <button
                type="button"
                className="underline opacity-80"
                disabled={revoke.isPending}
                onClick={() => void revoke.mutateAsync(i.phone)}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
