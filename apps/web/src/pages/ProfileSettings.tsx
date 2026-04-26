import { useEffect, useState } from "react";
import type { NotificationPrefs as NotificationPrefsValue } from "@garageborrow/shared";

import { AppShell } from "../components/AppShell";
import { DataExportButton } from "../components/Profile/DataExportButton";
import { DeleteAccountFlow } from "../components/Profile/DeleteAccountFlow";
import { NotificationPrefs } from "../components/Profile/NotificationPrefs";
import { VisibilityPreview } from "../components/Profile/VisibilityPreview";
import { useAuth } from "../lib/auth/AuthContext";
import { useTheme } from "../lib/theme/ThemeContext";
import type { ThemePreference } from "../lib/theme/ThemeContext";
import { useProfile, useUpdateProfile } from "../hooks/useProfile";

const themeOptions: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function ProfileSettings(): JSX.Element {
  const profile = useProfile();
  const update = useUpdateProfile();
  const { signOut } = useAuth();
  const { preference, setPreference } = useTheme();

  const [displayName, setDisplayName] = useState("");
  const [visibility, setVisibility] = useState<"visible" | "hidden">("visible");
  const [prefs, setPrefs] = useState<NotificationPrefsValue | null>(null);

  useEffect(() => {
    const u = profile.data?.user;
    if (!u) return;
    setDisplayName(u.display_name);
    setVisibility(u.visibility);
    setPrefs(u.notification_prefs);
  }, [profile.data?.user]);

  function saveDisplayName(): void {
    if (!displayName.trim() || !profile.data?.user) return;
    if (displayName === profile.data.user.display_name) return;
    update.mutate({ display_name: displayName });
  }

  function setVisibilityAndSave(next: "visible" | "hidden"): void {
    setVisibility(next);
    update.mutate({ visibility: next });
  }

  function setPrefsAndSave(next: NotificationPrefsValue): void {
    setPrefs(next);
    update.mutate({ notification_prefs: next });
  }

  return (
    <AppShell>
      <h1 className="font-heading text-3xl text-gold-bright">Profile</h1>

      {profile.isLoading ? (
        <p className="mt-3 text-sm opacity-70">Loading…</p>
      ) : profile.isError || !profile.data?.user ? (
        <p className="mt-3 text-sm text-status-overdue">Couldn&apos;t load your profile.</p>
      ) : (
        <div className="mt-6 space-y-10">
          <section>
            <h2 className="font-heading text-xl">Display name</h2>
            <p className="mt-1 text-xs opacity-70">
              How others see you. Default is first name + last initial.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onBlur={saveDisplayName}
                className="flex-1 rounded-xl border border-workshop/20 dark:border-surface-light/20 bg-transparent px-3 py-2 text-sm"
                data-testid="display-name-input"
              />
            </div>
          </section>

          <section>
            <h2 className="font-heading text-xl">Visibility</h2>
            <p className="mt-1 text-xs opacity-70">Here&apos;s what others see:</p>
            <div className="mt-3 flex gap-2" role="radiogroup" aria-label="Visibility">
              {(["visible", "hidden"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={visibility === v}
                  onClick={() => setVisibilityAndSave(v)}
                  className={`rounded-xl border px-4 py-2 text-sm capitalize ${
                    visibility === v
                      ? "border-gold-bright bg-gold-bright text-workshop font-semibold"
                      : "border-workshop/20 dark:border-surface-light/20"
                  }`}
                  data-testid={`visibility-${v}`}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="mt-4">
              <VisibilityPreview displayName={displayName || profile.data.user.display_name} />
            </div>
          </section>

          {prefs ? (
            <section>
              <h2 className="font-heading text-xl">Notifications</h2>
              <div className="mt-3">
                <NotificationPrefs
                  value={prefs}
                  onChange={setPrefsAndSave}
                  saving={update.isPending}
                />
              </div>
            </section>
          ) : null}

          <section>
            <h2 className="font-heading text-xl">Theme</h2>
            <div className="mt-3 inline-flex rounded-md border border-workshop/20 dark:border-surface-light/20 overflow-hidden">
              {themeOptions.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setPreference(o.value)}
                  className={`px-4 py-2 text-sm ${
                    preference === o.value
                      ? "bg-gold-bright text-workshop font-semibold"
                      : "opacity-80 hover:opacity-100"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="font-heading text-xl">Your data</h2>
            <div className="mt-3">
              <DataExportButton />
            </div>
          </section>

          <section>
            <h2 className="font-heading text-xl">Danger zone</h2>
            <p className="mt-1 text-xs opacity-70">
              You can change your mind for 30 days after scheduling.
            </p>
            <div className="mt-3">
              <DeleteAccountFlow deletedAt={profile.data.user.deleted_at} />
            </div>
          </section>

          <button
            type="button"
            onClick={signOut}
            className="text-sm underline opacity-70 hover:opacity-100"
          >
            Sign out
          </button>
        </div>
      )}
    </AppShell>
  );
}
