import { useState } from "react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

import { AppShell } from "../AppShell";

type SidebarItem = { to: string; label: string };

const SIDEBAR: SidebarItem[] = [
  { to: "/admin", label: "Out right now" },
  { to: "/admin/items", label: "Inventory" },
  { to: "/admin/members", label: "Members" },
  { to: "/admin/donations", label: "Donations" },
  { to: "/admin/wishlist", label: "Wishlist" },
  { to: "/admin/incidents", label: "Incidents" },
  { to: "/admin/activity", label: "Activity log" },
  { to: "/admin/settings", label: "Settings" },
];

type Props = { children: ReactNode };

// Owner admin chrome: persistent left rail on desktop, bottom-sheet menu on
// mobile. The content area receives whatever the active admin route renders.
export function AdminLayout({ children }: Props): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <AppShell fullBleed>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:flex-row">
        <aside className="hidden md:block md:w-56 md:shrink-0">
          <nav aria-label="Admin sections" className="space-y-1">
            {SIDEBAR.map((s) => (
              <NavLink
                key={s.to}
                to={s.to}
                end={s.to === "/admin"}
                className={({ isActive }) =>
                  `block rounded-xl px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "bg-gold-bright text-workshop font-semibold"
                      : "opacity-80 hover:bg-workshop/5 dark:hover:bg-surface-light/5"
                  }`
                }
              >
                {s.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="md:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            data-testid="admin-mobile-menu-toggle"
            className="flex w-full items-center justify-between rounded-xl border border-workshop/15 dark:border-surface-light/15 px-3 py-2 text-sm"
          >
            <span>Sections</span>
            <span aria-hidden>≡</span>
          </button>
        </div>

        <main className="flex-1 min-w-0">{children}</main>
      </div>

      {menuOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Admin sections"
          data-testid="admin-mobile-menu"
          className="fixed inset-0 z-50 flex items-end md:hidden"
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-workshop/60"
            onClick={() => setMenuOpen(false)}
          />
          <div className="relative w-full rounded-t-3xl bg-surface-light dark:bg-workshop p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-heading text-xl text-gold-bright">Sections</h2>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Close"
                className="rounded-full p-2 opacity-70 hover:opacity-100"
              >
                ✕
              </button>
            </div>
            <nav>
              <ul className="space-y-1">
                {SIDEBAR.map((s) => (
                  <li key={s.to}>
                    <NavLink
                      to={s.to}
                      end={s.to === "/admin"}
                      onClick={() => setMenuOpen(false)}
                      className={({ isActive }) =>
                        `block rounded-xl px-3 py-3 text-sm ${
                          isActive ? "bg-gold-bright text-workshop font-semibold" : "opacity-80"
                        }`
                      }
                    >
                      {s.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
