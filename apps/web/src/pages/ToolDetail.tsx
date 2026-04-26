import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";

import { AppShell } from "../components/AppShell";
import { HandlingNotes } from "../components/ToolDetail/HandlingNotes";
import { HeroImage } from "../components/ToolDetail/HeroImage";
import { InstanceList } from "../components/ToolDetail/InstanceList";
import { PrimaryAction } from "../components/ToolDetail/PrimaryAction";
import type { PrimaryActionMode } from "../components/ToolDetail/PrimaryAction";
import { BorrowDrawer } from "../components/Drawers/BorrowDrawer";
import { useToolDetail } from "../hooks/useToolDetail";
import { useJoinWaitlist, useLeaveWaitlist } from "../hooks/useWaitlist";

function isFamilyOnly(minTier: string, access: string): boolean {
  return minTier === "family" && access === "instant";
}

function modeFor(item: { status: string; access: string; min_tier: string }): PrimaryActionMode {
  if (isFamilyOnly(item.min_tier, item.access)) return "family_only";
  if (item.status === "all_loaned") return "waitlist";
  if (item.access === "request") return "borrow_request";
  return "borrow_instant";
}

export default function ToolDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const detail = useToolDetail(id);
  const navigate = useNavigate();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  const join = useJoinWaitlist();
  const leave = useLeaveWaitlist();

  const data = detail.data;
  const item = data?.item;

  const mode: PrimaryActionMode = useMemo(() => {
    if (!item) return "borrow_instant";
    if (data?.my_waitlist_entry) return "waitlist";
    return modeFor(item);
  }, [item, data?.my_waitlist_entry]);

  if (detail.isLoading || !data || !item) {
    return (
      <AppShell>
        <Link to="/" className="text-sm opacity-70 hover:opacity-100 underline">
          ← Back to pegboard
        </Link>
        <div className="mt-6 rounded-lg border border-workshop/10 dark:border-surface-light/10 p-8 text-center text-sm opacity-70">
          {detail.isError ? "Couldn't load this tool." : "Loading…"}
        </div>
      </AppShell>
    );
  }

  const onWaitlist = Boolean(data.my_waitlist_entry);

  function handlePrimary(): void {
    if (mode === "family_only") return;
    if (mode === "waitlist") {
      if (onWaitlist) return;
      join.mutate({ itemId: item!.id });
      return;
    }
    setDrawerOpen(true);
  }

  return (
    <AppShell>
      <Link to="/" className="text-sm opacity-70 hover:opacity-100 underline">
        ← Back to pegboard
      </Link>

      <div className="mt-3">
        <HeroImage itemId={item.id} photoKey={item.primary_photo_key} alt={item.name} />
      </div>

      <header className="mt-5">
        <h1 className="font-heading text-4xl text-gold-bright leading-tight">{item.name}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs opacity-80">
          <span className="rounded-full bg-workshop/10 dark:bg-surface-light/10 px-2 py-0.5 uppercase tracking-wide">
            {item.category}
          </span>
          {item.tags.map((t) => (
            <span
              key={t}
              className="rounded-full border border-workshop/15 dark:border-surface-light/15 px-2 py-0.5"
            >
              #{t}
            </span>
          ))}
        </div>
        {item.donated_by_display ? (
          <p className="mt-2 text-sm opacity-70">Donated by {item.donated_by_display}</p>
        ) : null}
      </header>

      {item.description ? (
        <p className="mt-4 text-base leading-relaxed text-workshop/90 dark:text-surface-light/90">
          {item.description}
        </p>
      ) : null}

      {data.handling_notes ? (
        <div className="mt-4">
          <HandlingNotes notes={data.handling_notes} />
        </div>
      ) : null}

      {data.instances.length > 1 ? (
        <section className="mt-6">
          <h2 className="font-heading text-xl mb-2">Pick yours</h2>
          <InstanceList
            instances={data.instances}
            selectedId={null}
            onSelect={() => setDrawerOpen(true)}
          />
        </section>
      ) : null}

      {data.my_waitlist_entry ? (
        <p
          data-testid="waitlist-position"
          className="mt-6 rounded-xl border border-gold-accent/40 bg-gold-accent/10 p-4 text-sm font-semibold"
        >
          You&apos;re #{data.my_waitlist_entry.position} in line.
        </p>
      ) : null}

      <div className="mt-6">
        <PrimaryAction
          item={item}
          mode={mode}
          waitlistSize={data.waitlist_size}
          onClick={handlePrimary}
          busy={join.isPending}
        />
        {data.my_waitlist_entry ? (
          <button
            type="button"
            onClick={() =>
              leave.mutate({
                entryId: data.my_waitlist_entry!.id,
                itemId: item.id,
              })
            }
            disabled={leave.isPending}
            className="mt-2 block w-full rounded-xl border border-workshop/20 dark:border-surface-light/20 px-4 py-2 text-sm opacity-90 hover:opacity-100"
          >
            {leave.isPending ? "Leaving…" : "Leave waitlist"}
          </button>
        ) : null}
      </div>

      <BorrowDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        item={item}
        instances={data.instances}
        mode={mode === "borrow_request" ? "request" : "instant"}
        onSuccess={() => {
          setDrawerOpen(false);
          setCelebrate(true);
          window.setTimeout(() => navigate("/me"), 900);
        }}
      />

      <AnimatePresence>
        {celebrate ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 20 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-workshop/40"
          >
            <div className="rounded-2xl bg-surface-light dark:bg-workshop px-8 py-6 text-center shadow-2xl">
              <p className="font-heading text-3xl text-gold-bright">It&apos;s yours!</p>
              <p className="mt-1 text-sm opacity-80">Have fun. Bring it home in one piece.</p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </AppShell>
  );
}
