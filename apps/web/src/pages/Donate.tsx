import { Link } from "react-router-dom";

import { AppShell } from "../components/AppShell";
import { DonateForm } from "../components/Donate/DonateForm";

export default function Donate(): JSX.Element {
  return (
    <AppShell>
      <header className="mb-4">
        <h1 className="font-heading text-3xl">Donate something</h1>
        <p className="mt-1 text-sm opacity-80">Got gear gathering dust? Offer it to the garage.</p>
      </header>
      <DonateForm />
      <p className="mt-6 text-sm opacity-70">
        Looking for past offers? See your{" "}
        <Link to="/me/donations" className="font-semibold underline">
          donations history
        </Link>
        .
      </p>
    </AppShell>
  );
}
