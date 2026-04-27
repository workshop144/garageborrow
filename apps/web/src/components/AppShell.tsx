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
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-gold-bright focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-workshop focus:outline-none focus:ring-2 focus:ring-gold-accent"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-10 border-b border-workshop/10 dark:border-surface-light/10 bg-surface-light/90 dark:bg-surface-dark/90 backdrop-blur pt-[env(safe-area-inset-top)]">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <Link
            to="/"
            className="font-heading text-2xl text-gold-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-accent rounded-md"
          >
            Garage
          </Link>
          <nav aria-label="Header" className="flex gap-4 text-sm">
            <NavLink
              to="/me/notifications"
              className={({ isActive }) =>
                `${isActive ? "font-semibold underline" : "opacity-80 hover:opacity-100"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-accent rounded-md px-1`
              }
            >
              Inbox
            </NavLink>
          </nav>
        </div>
      </header>
      <main
        id="main-content"
        className={fullBleed ? "flex-1 w-full" : "flex-1 mx-auto w-full max-w-3xl px-4 py-6"}
      >
        {children}
      </main>
      <footer className="mx-auto w-full max-w-3xl px-4 py-4 text-center text-xs opacity-70">
        <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-4 gap-y-1">
          <Link
            to="/legal/terms"
            className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-accent rounded-md px-1"
          >
            Terms
          </Link>
          <Link
            to="/legal/privacy"
            className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-accent rounded-md px-1"
          >
            Privacy
          </Link>
        </nav>
      </footer>
      <BottomNav />
    </div>
  );
}
