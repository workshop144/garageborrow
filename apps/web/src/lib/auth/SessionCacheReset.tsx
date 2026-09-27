import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useAuth } from "./AuthContext";

// When a session ends (sign-out or a failed refresh), drop everything cached for
// that user: React Query's in-memory data and the service worker's API cache, so
// the next person to sign in on this device never sees the previous user's data.
export function SessionCacheReset(): null {
  const { status } = useAuth();
  const queryClient = useQueryClient();
  const wasSignedIn = useRef(false);
  useEffect(() => {
    if (status === "authenticated") {
      wasSignedIn.current = true;
    } else if (status === "anonymous" && wasSignedIn.current) {
      wasSignedIn.current = false;
      queryClient.clear();
      if (typeof caches !== "undefined") void caches.delete("api").catch(() => undefined);
    }
  }, [status, queryClient]);
  return null;
}
