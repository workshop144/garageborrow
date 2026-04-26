import { Link } from "react-router-dom";

import { AppShell } from "../components/AppShell";
import { FamilyPromotionOverlay } from "../components/Celebration/FamilyPromotionOverlay";
import { LoanCard } from "../components/MyStuff/LoanCard";
import { ReservationCard } from "../components/MyStuff/ReservationCard";
import { StatsChips } from "../components/MyStuff/StatsChips";
import { WaitlistItem } from "../components/MyStuff/WaitlistItem";
import { useAuth } from "../lib/auth/AuthContext";
import { useMe } from "../lib/hooks/useMe";
import { useMyStuff } from "../hooks/useMyStuff";

export default function MyStuff(): JSX.Element {
  const { username } = useAuth();
  const stuff = useMyStuff();
  const me = useMe();

  const data = stuff.data ?? {
    loans: [],
    reservations: [],
    waitlist: [],
    stats: { borrows_total: 0, returns_on_time: 0, borrows_active: 0 },
  };
  const empty =
    data.loans.length === 0 && data.reservations.length === 0 && data.waitlist.length === 0;

  return (
    <AppShell>
      <header className="mb-4">
        <h1 className="font-heading text-3xl text-gold-bright">My Stuff</h1>
        {me.data?.tier === "family" ? (
          <span className="mt-2 inline-block rounded-full bg-gold-bright/20 px-2 py-0.5 text-xs font-semibold text-gold-bright">
            Family member
          </span>
        ) : null}
      </header>

      <StatsChips stats={data.stats} />

      {stuff.isLoading ? (
        <p className="mt-6 text-sm opacity-70">Loading…</p>
      ) : stuff.isError ? (
        <p className="mt-6 text-sm text-status-overdue">
          Couldn&apos;t load your stuff. Pull to refresh.
        </p>
      ) : empty ? (
        <div className="mt-6 rounded-2xl border border-workshop/15 dark:border-surface-light/15 bg-surface-light/60 dark:bg-workshop/40 p-8 text-center">
          <p className="font-heading text-xl">Pegboard&apos;s full and your hands are empty.</p>
          <p className="mt-2 text-sm opacity-70">
            <Link to="/" className="underline">
              Go grab something.
            </Link>
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {data.loans.length > 0 ? (
            <section>
              <h2 className="mb-3 font-heading text-xl">You have these right now</h2>
              <div className="space-y-3">
                {data.loans.map((l) => (
                  <LoanCard key={l.loan.id} loan={l} />
                ))}
              </div>
            </section>
          ) : null}

          {data.reservations.length > 0 ? (
            <section>
              <h2 className="mb-3 font-heading text-xl">Reserved</h2>
              <div className="space-y-3">
                {data.reservations.map((r) => (
                  <ReservationCard key={r.reservation.id} reservation={r} />
                ))}
              </div>
            </section>
          ) : null}

          {data.waitlist.length > 0 ? (
            <section>
              <h2 className="mb-3 font-heading text-xl">Waiting on</h2>
              <div className="space-y-3">
                {data.waitlist.map((w) => (
                  <WaitlistItem key={w.entry.id} entry={w} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}

      <FamilyPromotionOverlay
        userKey={username ?? ""}
        shouldCelebrate={me.data?.tier === "family"}
      />
    </AppShell>
  );
}
