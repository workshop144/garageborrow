import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

const tabs = [
  { to: "/", label: "Pegboard" },
  { to: "/donate", label: "Donate" },
  { to: "/me", label: "My Stuff" },
];

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen flex flex-col bg-surface-light dark:bg-surface-dark text-workshop dark:text-surface-light">
      <header className="sticky top-0 z-10 border-b border-workshop/10 dark:border-surface-light/10 bg-surface-light/90 dark:bg-surface-dark/90 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <Link to="/" className="font-heading text-2xl text-gold-bright">
            Garage
          </Link>
          <nav className="flex gap-4 text-sm">
            <NavLink
              to="/me/notifications"
              className={({ isActive }) =>
                isActive ? "font-semibold underline" : "opacity-80 hover:opacity-100"
              }
            >
              Inbox
            </NavLink>
            <NavLink
              to="/me/profile"
              className={({ isActive }) =>
                isActive ? "font-semibold underline" : "opacity-80 hover:opacity-100"
              }
            >
              Profile
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-3xl px-4 py-6">{children}</main>
      <nav
        aria-label="Primary"
        className="sticky bottom-0 border-t border-workshop/10 dark:border-surface-light/10 bg-surface-light/95 dark:bg-surface-dark/95 backdrop-blur"
      >
        <div className="mx-auto max-w-3xl grid grid-cols-3">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === "/"}
              className={({ isActive }) =>
                `py-3 text-center text-sm ${
                  isActive ? "text-gold-bright font-semibold" : "opacity-70 hover:opacity-100"
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
