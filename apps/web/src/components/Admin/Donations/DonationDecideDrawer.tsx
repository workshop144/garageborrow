import { useState } from "react";
import type { DonationOffer, TierName } from "@garageborrow/shared";

import { Drawer } from "../../Drawers/Drawer";
import { useDecideDonation } from "../../../hooks/useAdminDonations";

type Props = {
  open: boolean;
  onClose: () => void;
  donation: DonationOffer | null;
};

const TIERS: TierName[] = ["howdy", "friend", "family"];

export function DonationDecideDrawer({ open, onClose, donation }: Props): JSX.Element {
  const [mode, setMode] = useState<"accept" | "decline">("accept");
  const [category, setCategory] = useState("");
  const [minTier, setMinTier] = useState<TierName>("howdy");
  const [autoTier, setAutoTier] = useState<TierName>("family");
  const [declineReason, setDeclineReason] = useState("");
  const decide = useDecideDonation();

  async function submit(): Promise<void> {
    if (!donation) return;
    if (mode === "decline") {
      if (!declineReason.trim()) return;
      await decide.mutateAsync({
        donationId: donation.id,
        decision: "decline",
        decline_reason: declineReason,
      });
    } else {
      await decide.mutateAsync({
        donationId: donation.id,
        decision: "accept",
        item_overrides: {
          ...(category ? { category } : {}),
          min_tier: minTier,
          auto_approve_tier: autoTier,
        },
      });
    }
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={donation ? donation.item_name : "Donation"}
      testid="donation-decide-drawer"
    >
      {donation ? (
        <div className="space-y-3 text-sm">
          <p className="opacity-80">{donation.description}</p>
          <p className="text-xs opacity-70">Condition: {donation.condition}</p>
          {donation.donor_notes ? (
            <p className="text-xs italic opacity-70">“{donation.donor_notes}”</p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode("accept")}
              className={`rounded-xl px-3 py-2 text-sm ${
                mode === "accept"
                  ? "bg-gold-bright font-semibold text-workshop"
                  : "border border-workshop/15 dark:border-surface-light/15"
              }`}
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => setMode("decline")}
              className={`rounded-xl px-3 py-2 text-sm ${
                mode === "decline"
                  ? "bg-status-overdue font-semibold text-surface-light"
                  : "border border-workshop/15 dark:border-surface-light/15"
              }`}
            >
              Decline
            </button>
          </div>

          {mode === "accept" ? (
            <div className="space-y-2">
              <label className="block">
                <span className="font-semibold">Category</span>
                <input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder={donation.suggested_category ?? ""}
                  className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="font-semibold">Min tier</span>
                  <select
                    value={minTier}
                    onChange={(e) => setMinTier(e.target.value as TierName)}
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
                    value={autoTier}
                    onChange={(e) => setAutoTier(e.target.value as TierName)}
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
            </div>
          ) : (
            <label className="block">
              <span className="font-semibold">Reason (sent to donor)</span>
              <textarea
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
              />
            </label>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-workshop/15 dark:border-surface-light/15 px-3 py-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={decide.isPending}
              className="rounded-xl bg-gold-bright px-3 py-2 font-semibold text-workshop disabled:opacity-50"
            >
              {decide.isPending ? "Saving…" : mode === "accept" ? "Accept" : "Decline"}
            </button>
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}
