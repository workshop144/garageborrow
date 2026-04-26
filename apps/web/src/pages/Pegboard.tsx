import { AppShell } from "../components/AppShell";

const placeholderTools = Array.from({ length: 12 }, (_, i) => ({
  id: `tool-${i + 1}`,
  name: `Tool ${i + 1}`,
}));

export default function Pegboard(): JSX.Element {
  return (
    <AppShell>
      <section className="bg-pegboard rounded-lg border border-workshop/10 dark:border-surface-light/10 p-4">
        <h1 className="font-heading text-3xl mb-1">The Pegboard</h1>
        <p className="text-sm opacity-70 mb-4">Tap a tool to borrow it.</p>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {placeholderTools.map((t) => (
            <div
              key={t.id}
              className="aspect-square rounded-md bg-gold-primary/20 dark:bg-gold-primary/30 border border-gold-primary/40 flex items-center justify-center text-sm"
            >
              {t.name}
            </div>
          ))}
        </div>
        <p className="mt-6 text-xs opacity-60">
          Real pegboard arrives in the next PR — this is the placeholder grid.
        </p>
      </section>
    </AppShell>
  );
}
