import { useEffect, useState } from "react";
import type { NotificationPrefs as NotificationPrefsValue } from "@garageborrow/shared";

import {
  ensurePushSubscription,
  getPermissionState,
  type PermissionState,
} from "../../lib/pushSubscription";
import { QuietHoursPicker, isValidHhMm } from "./QuietHoursPicker";

type Props = {
  value: NotificationPrefsValue;
  onChange: (next: NotificationPrefsValue) => void;
  saving?: boolean;
};

const TOGGLE_FIELDS: Array<{ key: keyof NotificationPrefsValue; label: string; hint?: string }> = [
  { key: "reminders", label: "Reminders", hint: "Borrow returns, due dates, gentle nudges" },
  { key: "waitlist_updates", label: "Waitlist updates", hint: "When something opens up" },
  { key: "new_tools", label: "New tools", hint: "When Dad puts something new on the pegboard" },
  { key: "promotion_celebrations", label: "Promotion celebrations" },
];

export function NotificationPrefs({ value, onChange, saving }: Props): JSX.Element {
  const [pushPromptShown, setPushPromptShown] = useState(false);
  const [permission, setPermission] = useState<PermissionState>(() => getPermissionState());

  useEffect(() => {
    setPermission(getPermissionState());
  }, [value.push_enabled]);

  function set<K extends keyof NotificationPrefsValue>(key: K, v: NotificationPrefsValue[K]): void {
    onChange({ ...value, [key]: v });
  }

  async function togglePush(next: boolean): Promise<void> {
    if (next) {
      setPushPromptShown(true);
      // ensurePushSubscription handles permission, SW registration, and the
      // POST to /v1/me/push-subscription. We mirror its outcome into the
      // local permission state so the UX label updates without a reload.
      const result = await ensurePushSubscription();
      setPermission(getPermissionState());
      if (result.status === "denied") {
        // Don't claim push is enabled if the browser denied it.
        set("push_enabled", false);
        return;
      }
    }
    set("push_enabled", next);
  }

  const permissionLabel = (() => {
    if (permission === "unsupported") return "Not supported on this device";
    if (permission === "denied") return "Permission denied — open browser settings";
    if (permission === "granted") return value.push_enabled ? "Enabled" : "Disabled";
    return "Disabled";
  })();

  return (
    <div className="space-y-4" data-testid="notification-prefs">
      <div className="space-y-2">
        {TOGGLE_FIELDS.map((f) => (
          <label
            key={f.key}
            className="flex items-start justify-between gap-3 rounded-xl border border-workshop/10 dark:border-surface-light/10 p-3"
          >
            <span className="text-sm">
              <span className="font-semibold">{f.label}</span>
              {f.hint ? <span className="block text-xs opacity-70">{f.hint}</span> : null}
            </span>
            <input
              type="checkbox"
              checked={value[f.key] as boolean}
              onChange={(e) => set(f.key, e.target.checked as never)}
              className="h-5 w-5 accent-gold-bright"
              data-testid={`pref-${f.key}`}
            />
          </label>
        ))}
      </div>

      <fieldset className="rounded-xl border border-workshop/10 dark:border-surface-light/10 p-3">
        <legend className="px-2 text-xs uppercase tracking-wide opacity-70">
          How to reach you
        </legend>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex items-center justify-between rounded-lg border border-workshop/10 dark:border-surface-light/10 px-3 py-2 text-sm">
            <span>Text me</span>
            <input
              type="checkbox"
              checked={value.sms_enabled}
              onChange={(e) => set("sms_enabled", e.target.checked)}
              className="h-5 w-5 accent-gold-bright"
              data-testid="pref-sms"
            />
          </label>
          <label className="flex items-center justify-between rounded-lg border border-workshop/10 dark:border-surface-light/10 px-3 py-2 text-sm">
            <span>Push</span>
            <input
              type="checkbox"
              checked={value.push_enabled}
              onChange={(e) => void togglePush(e.target.checked)}
              className="h-5 w-5 accent-gold-bright"
              data-testid="pref-push"
              disabled={permission === "unsupported"}
            />
          </label>
        </div>
        <p className="mt-2 text-xs opacity-70" data-testid="pref-push-status">
          Push notifications: <span className="font-semibold">{permissionLabel}</span>
        </p>
        {pushPromptShown ? (
          <p className="mt-2 text-xs opacity-70">
            We just asked your browser for push permission. If you missed the prompt, check your
            site settings.
          </p>
        ) : null}
      </fieldset>

      <fieldset className="rounded-xl border border-workshop/10 dark:border-surface-light/10 p-3">
        <legend className="px-2 text-xs uppercase tracking-wide opacity-70">Quiet hours</legend>
        <p className="mb-2 text-xs opacity-70">
          We&apos;ll hold non-urgent texts during these hours (the garage&apos;s local time).
        </p>
        <QuietHoursPicker
          start={value.quiet_hours_start}
          end={value.quiet_hours_end}
          onChange={({ start, end }) =>
            onChange({
              ...value,
              quiet_hours_start: isValidHhMm(start) ? start : value.quiet_hours_start,
              quiet_hours_end: isValidHhMm(end) ? end : value.quiet_hours_end,
            })
          }
        />
      </fieldset>

      {saving ? <p className="text-xs opacity-60">Saving…</p> : null}
    </div>
  );
}
