import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useMe } from "../../lib/hooks/useMe";

type Props = {
  children: ReactNode;
};

// Route wrapper for owner-only admin pages. Sources owner status from /v1/me
// (tier === "owner") so it stays in sync if ownership ever changes server-side.
export function AdminGuard({ children }: Props): JSX.Element {
  const me = useMe();
  if (me.isLoading) {
    return (
      <div
        data-testid="admin-guard-loading"
        className="flex min-h-screen items-center justify-center text-sm opacity-70"
      >
        Checking permissions…
      </div>
    );
  }
  if (me.isError || !me.data) {
    return <Navigate to="/" replace />;
  }
  if (me.data.tier !== "owner") {
    return <Navigate to="/" replace data-testid="admin-guard-redirect" />;
  }
  return <>{children}</>;
}
