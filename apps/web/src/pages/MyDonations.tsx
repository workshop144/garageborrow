import { AppShell } from "../components/AppShell";
import { MyDonationsList } from "../components/Donate/MyDonationsList";

export default function MyDonations(): JSX.Element {
  return (
    <AppShell>
      <header className="mb-4">
        <h1 className="font-heading text-3xl">My donations</h1>
        <p className="mt-1 text-sm opacity-80">Things you&apos;ve offered to the garage.</p>
      </header>
      <MyDonationsList />
    </AppShell>
  );
}
