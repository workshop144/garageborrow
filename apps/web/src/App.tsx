import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { AuthProvider, useAuth } from "./lib/auth/AuthContext";
import { ProtectedRoute } from "./lib/auth/ProtectedRoute";
import { ThemeProvider } from "./lib/theme/ThemeContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { createQueryClient } from "./lib/queryClient";
import { setAuthTokenProvider } from "./lib/api";

import Pegboard from "./pages/Pegboard";
import Login from "./pages/Login";
import Onboarding from "./pages/Onboarding";
import ToolDetail from "./pages/ToolDetail";
import MyStuff from "./pages/MyStuff";
import Profile from "./pages/Profile";
import Notifications from "./pages/Notifications";
import Donate from "./pages/Donate";
import PayItForward from "./pages/PayItForward";
import Admin from "./pages/Admin";
import LegalTerms from "./pages/LegalTerms";
import LegalPrivacy from "./pages/LegalPrivacy";
import Offline from "./pages/Offline";
import NotFound from "./pages/NotFound";

function ApiTokenBridge(): null {
  const { getAccessToken } = useAuth();
  useEffect(() => {
    setAuthTokenProvider(getAccessToken);
    return () => setAuthTokenProvider(() => null);
  }, [getAccessToken]);
  return null;
}

export default function App(): JSX.Element {
  const queryClient = useMemo(() => createQueryClient(), []);
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider>
              <ApiTokenBridge />
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/legal/terms" element={<LegalTerms />} />
                <Route path="/legal/privacy" element={<LegalPrivacy />} />
                <Route path="/offline" element={<Offline />} />

                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <Pegboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/onboarding"
                  element={
                    <ProtectedRoute>
                      <Onboarding />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/tool/:id"
                  element={
                    <ProtectedRoute>
                      <ToolDetail />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/me"
                  element={
                    <ProtectedRoute>
                      <MyStuff />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/me/profile"
                  element={
                    <ProtectedRoute>
                      <Profile />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/me/notifications"
                  element={
                    <ProtectedRoute>
                      <Notifications />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/donate"
                  element={
                    <ProtectedRoute>
                      <Donate />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/pay-it-forward"
                  element={
                    <ProtectedRoute>
                      <PayItForward />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute>
                      <Admin />
                    </ProtectedRoute>
                  }
                />
                <Route path="/index.html" element={<Navigate to="/" replace />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
