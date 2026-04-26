import { useEffect, useState } from "react";
import type { GarageMembership, TierName } from "@garageborrow/shared";

import { Drawer } from "../../Drawers/Drawer";
import { useUpdateMember } from "../../../hooks/useAdminMembers";

type Props = {
  open: boolean;
  onClose: () => void;
  member: GarageMembership | null;
};

const TIERS: TierName[] = ["howdy", "friend", "family"];

export function MemberEditDrawer({ open, onClose, member }: Props): JSX.Element {
  const [tier, setTier] = useState<TierName>("howdy");
  const [notes, setNotes] = useState("");
  const update = useUpdateMember();

  useEffect(() => {
    if (member) {
      setTier(member.tier);
      setNotes(member.notes ?? "");
    }
  }, [member]);

  async function save(): Promise<void> {
    if (!member) return;
    await update.mutateAsync({
      phone: member.user_phone,
      body: {
        ...(tier !== member.tier ? { tier } : {}),
        ...(notes !== (member.notes ?? "") ? { notes } : {}),
      },
    });
    onClose();
  }

  return (
    <Drawer open={open} onClose={onClose} title="Member" testid="member-edit-drawer">
      {member ? (
        <div className="space-y-3 text-sm">
          <div>
            <p className="font-semibold">{member.user_phone}</p>
            <p className="opacity-70">Joined {member.joined_at.slice(0, 10)}</p>
          </div>
          <label className="block">
            <span className="font-semibold">Tier</span>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value as TierName)}
              className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
              data-testid="member-tier-select"
            >
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="font-semibold">Notes (private)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2"
            />
          </label>
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-workshop/15 dark:border-surface-light/15 p-2 text-xs">
            <div>
              <p className="opacity-70">Borrows</p>
              <p className="font-semibold">{member.borrows_total}</p>
            </div>
            <div>
              <p className="opacity-70">On-time</p>
              <p className="font-semibold">{member.returns_on_time}</p>
            </div>
            <div>
              <p className="opacity-70">Late</p>
              <p className="font-semibold">{member.returns_late}</p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-workshop/15 dark:border-surface-light/15 px-3 py-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={update.isPending}
              className="rounded-xl bg-gold-bright px-3 py-2 font-semibold text-workshop disabled:opacity-50"
            >
              {update.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}
