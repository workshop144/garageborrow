import { AppShell } from "../components/AppShell";
import { useMe } from "../lib/hooks/useMe";

export default function Admin(): JSX.Element {
  const me = useMe();

  if (me.isLoading) {
    return (
      <AppShell>
        <p className="opacity-70">Checking permissions…</p>
      </AppShell>
    );
  }
  if (me.data?.tier !== "owner") {
    return (
      <AppShell>
        <h1 className="font-heading text-3xl">Admin</h1>
        <p className="mt-3 opacity-80">This area is owner-only.</p>
      </AppShell>
    );
  }
  return (
    <AppShell>
      <h1 className="font-heading text-3xl">Admin</h1>
      <p className="mt-3 opacity-80">Owner controls land in a follow-up PR.</p>
    </AppShell>
  );
}
