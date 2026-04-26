import { AppShell } from "../components/AppShell";
import { useTheme } from "../lib/theme/ThemeContext";
import type { ThemePreference } from "../lib/theme/ThemeContext";

const options: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function Profile(): JSX.Element {
  const { preference, setPreference } = useTheme();
  return (
    <AppShell>
      <h1 className="font-heading text-3xl">Profile</h1>
      <section className="mt-6">
        <h2 className="font-heading text-xl">Appearance</h2>
        <div className="mt-3 inline-flex rounded-md border border-workshop/20 dark:border-surface-light/20 overflow-hidden">
          {options.map((o) => (
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
      <section className="mt-8">
        <h2 className="font-heading text-xl">Account</h2>
        <p className="mt-2 text-sm opacity-70">Display name and photo land in a follow-up PR.</p>
      </section>
    </AppShell>
  );
}
