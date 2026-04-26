import { useProfile, useUpdateProfile } from "../../hooks/useProfile";

export function ComingSoonCard(): JSX.Element {
  const profile = useProfile();
  const update = useUpdateProfile();
  const aiReady = profile.data?.user.notification_prefs.ai_ready_notify ?? false;

  function toggle(): void {
    update.mutate({ notification_prefs: { ai_ready_notify: !aiReady } });
  }

  return (
    <section
      className="relative overflow-hidden rounded-xl border border-gold-bright/40 bg-gradient-to-br from-gold-bright/30 via-gold-primary/10 to-tier-howdy/20 p-4 shadow-[0_4px_12px_rgba(184,140,38,0.18)]"
      data-testid="ai-coming-soon"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl">Ask Dad&apos;s Garage</h2>
          <p className="mt-1 text-sm">
            Coming soon. AI helper to find the right tool, walk you through using it, or sort out a
            project.
          </p>
        </div>
        <span
          className="rounded-full bg-gold-bright px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-workshop"
          aria-hidden="true"
        >
          Soon
        </span>
      </div>
      <button
        type="button"
        onClick={toggle}
        disabled={update.isPending}
        className={`mt-3 rounded-xl px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
          aiReady
            ? "bg-status-on-time/20 text-status-on-time"
            : "bg-workshop text-surface-light hover:bg-workshop/90"
        }`}
        data-testid="ai-notify-toggle"
        aria-pressed={aiReady}
      >
        {aiReady ? "We'll let you know — tap to undo" : "Get notified when it's ready"}
      </button>
      <p className="mt-2 text-[11px] uppercase tracking-wide opacity-70">
        Family perk · Coming soon
      </p>
    </section>
  );
}
