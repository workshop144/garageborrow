import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../lib/auth/AuthContext";

export default function MyStuff(): JSX.Element {
  const { username, signOut } = useAuth();
  return (
    <AppShell>
      <h1 className="font-heading text-3xl">My Stuff</h1>
      <p className="mt-1 text-sm opacity-70">
        Signed in as <span className="font-mono">{username}</span>
      </p>
      <ul className="mt-6 space-y-2">
        <li>
          <Link to="/me/profile" className="underline">
            Profile settings
          </Link>
        </li>
        <li>
          <Link to="/me/notifications" className="underline">
            Notifications inbox
          </Link>
        </li>
      </ul>
      <button onClick={signOut} className="mt-8 text-sm underline opacity-70 hover:opacity-100">
        Sign out
      </button>
    </AppShell>
  );
}
