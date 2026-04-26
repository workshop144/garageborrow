import { Link, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";

export default function ToolDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  return (
    <AppShell>
      <Link to="/" className="text-sm opacity-70 hover:opacity-100 underline">
        ← Back to pegboard
      </Link>
      <h1 className="mt-2 font-heading text-3xl">Tool {id}</h1>
      <p className="mt-2 opacity-80">Tool detail UI lands in a follow-up PR.</p>
    </AppShell>
  );
}
