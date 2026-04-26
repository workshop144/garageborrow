import { NavLink } from "react-router-dom";
import { useMe } from "../../lib/hooks/useMe";

type Tab = {
  to: string;
  label: string;
  icon: JSX.Element;
  end?: boolean;
};

const PEGBOARD_ICON = (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8" cy="8" r="1" fill="currentColor" />
    <circle cx="16" cy="8" r="1" fill="currentColor" />
    <circle cx="8" cy="16" r="1" fill="currentColor" />
    <circle cx="16" cy="16" r="1" fill="currentColor" />
  </svg>
);

const MY_STUFF_ICON = (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M3 7h18M3 12h18M3 17h12" strokeLinecap="round" />
  </svg>
);

const DONATE_ICON = (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
  </svg>
);

const ADMIN_ICON = (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

const PROFILE_ICON = (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);

const BASE_TABS: Tab[] = [
  { to: "/", label: "Pegboard", icon: PEGBOARD_ICON, end: true },
  { to: "/me", label: "My Stuff", icon: MY_STUFF_ICON },
  { to: "/donate", label: "Donate", icon: DONATE_ICON },
];

const PROFILE_TAB: Tab = { to: "/me/profile", label: "Profile", icon: PROFILE_ICON };
const ADMIN_TAB: Tab = { to: "/admin", label: "Admin", icon: ADMIN_ICON };

export function BottomNav(): JSX.Element {
  const me = useMe();
  const isOwner = me.data?.tier === "owner";
  const tabs: Tab[] = isOwner
    ? [...BASE_TABS, ADMIN_TAB, PROFILE_TAB]
    : [...BASE_TABS, PROFILE_TAB];

  return (
    <nav
      aria-label="Primary"
      className="sticky bottom-0 z-10 border-t border-workshop/10 dark:border-surface-light/10 bg-surface-light/95 dark:bg-surface-dark/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      <ul
        className="mx-auto max-w-3xl grid"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((t) => (
          <li key={t.to}>
            <NavLink
              to={t.to}
              end={t.end ?? false}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] transition-colors ${
                  isActive
                    ? "bg-gold-bright text-workshop font-semibold"
                    : "opacity-70 hover:opacity-100"
                }`
              }
            >
              {t.icon}
              <span>{t.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
