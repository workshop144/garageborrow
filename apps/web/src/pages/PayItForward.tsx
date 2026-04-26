import { AppShell } from "../components/AppShell";

export default function PayItForward(): JSX.Element {
  return (
    <AppShell>
      <h1 className="font-heading text-3xl">Pay it forward</h1>
      <p className="mt-3 opacity-80">
        If you can spare a buck for the cause, more details ship in a follow-up PR.
      </p>
    </AppShell>
  );
}
