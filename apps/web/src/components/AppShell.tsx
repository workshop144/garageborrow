import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { BottomNav } from "./Layout/BottomNav";

type Props = {
  children: ReactNode;
  fullBleed?: boolean;
};

export function AppShell({ children, fullBleed = false }: Props): JSX.Element {
  return (
    <div className="min-h-screen flex flex-col bg-surface-light dark:bg-surface-dark text-workshop dark:text-surface-light">
      <header className="sticky top-0 z-10 border-b border-workshop/10 dark:border-surface-light/10 bg-surface-light/90 dark:bg-surface-dark/90 backdrop-blur pt-[env(safe-area-inset-top)]">
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
          </nav>
        </div>
      </header>
      <main className={fullBleed ? "flex-1 w-full" : "flex-1 mx-auto w-full max-w-3xl px-4 py-6"}>
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
