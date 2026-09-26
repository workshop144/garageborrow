import { Link } from "react-router-dom";

import { AppShell } from "../components/AppShell";
import { NonprofitCard } from "../components/PayItForward/NonprofitCard";
import { usePayForward } from "../hooks/usePayForward";
import { TENANT_NAME } from "../lib/tenant";

const DEFAULT_INTRO = `${TENANT_NAME} takes no money — ever. If you want to give back in dollars instead of a borrowed mower returned with a full tank, here's where to point them.`;

export default function PayItForward(): JSX.Element {
  const q = usePayForward();

  // Hidden entirely when the admin has cleared the list. We still render the
  // shell so the route doesn't 404 — just a friendly empty state.
  if (q.isLoading) {
    return (
      <AppShell>
        <p className="rounded-xl border border-workshop/10 dark:border-surface-light/10 p-6 text-center text-sm opacity-70">
          Loading…
        </p>
      </AppShell>
    );
  }

  const orgs = q.data?.orgs ?? [];
  const intro = q.data?.introCopy?.trim() || DEFAULT_INTRO;

  if (orgs.length === 0) {
    return (
      <AppShell>
        <header className="mb-4">
          <h1 className="font-heading text-3xl">Pay it forward</h1>
        </header>
        <div
          className="rounded-xl border border-workshop/15 dark:border-surface-light/10 p-6"
          data-testid="payforward-empty"
        >
          <p className="text-sm">
            No nonprofits configured yet. Want to give back another way?{" "}
            <Link to="/donate" className="font-semibold underline">
              Donate something to the garage instead
            </Link>{" "}
            — borrowers can pass that gear along to others for years.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <header className="mb-4">
        <h1 className="font-heading text-3xl">Pay it forward</h1>
        <p className="mt-2 text-sm opacity-90" data-testid="payforward-intro">
          {intro}
        </p>
      </header>
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="payforward-orgs">
        {orgs.map((org) => (
          <NonprofitCard key={`${org.name}-${org.display_order}`} org={org} />
        ))}
      </section>
      <footer className="mt-8 rounded-xl border border-workshop/15 dark:border-surface-light/10 p-4 text-sm">
        Want to give back another way?{" "}
        <Link to="/donate" className="font-semibold underline" data-testid="payforward-donate-link">
          Donate something to the garage instead
        </Link>{" "}
        — borrowers can pass that gear along to others for years.
      </footer>
    </AppShell>
  );
}
