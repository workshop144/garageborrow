import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
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
import Members from "./pages/Members";
import ProfileSettings from "./pages/ProfileSettings";
import NotificationsInbox from "./pages/NotificationsInbox";
import Donate from "./pages/Donate";
import MyDonations from "./pages/MyDonations";
import PayItForward from "./pages/PayItForward";
import OutRightNow from "./pages/admin/OutRightNow";
import Inventory from "./pages/admin/Inventory";
import MembersAdmin from "./pages/admin/MembersAdmin";
import Donations from "./pages/admin/Donations";
import Incidents from "./pages/admin/Incidents";
import Activity from "./pages/admin/Activity";
import Settings from "./pages/admin/Settings";
import { AdminGuard } from "./components/Admin/AdminGuard";
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
        <MotionConfig reducedMotion="user">
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
                        <ProfileSettings />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/me/notifications"
                    element={
                      <ProtectedRoute>
                        <NotificationsInbox />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/g/:garage/members"
                    element={
                      <ProtectedRoute>
                        <Members />
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
                    path="/me/donations"
                    element={
                      <ProtectedRoute>
                        <MyDonations />
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
                        <AdminGuard>
                          <OutRightNow />
                        </AdminGuard>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/items"
                    element={
                      <ProtectedRoute>
                        <AdminGuard>
                          <Inventory />
                        </AdminGuard>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/members"
                    element={
                      <ProtectedRoute>
                        <AdminGuard>
                          <MembersAdmin />
                        </AdminGuard>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/donations"
                    element={
                      <ProtectedRoute>
                        <AdminGuard>
                          <Donations />
                        </AdminGuard>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/incidents"
                    element={
                      <ProtectedRoute>
                        <AdminGuard>
                          <Incidents />
                        </AdminGuard>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/activity"
                    element={
                      <ProtectedRoute>
                        <AdminGuard>
                          <Activity />
                        </AdminGuard>
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/settings"
                    element={
                      <ProtectedRoute>
                        <AdminGuard>
                          <Settings />
                        </AdminGuard>
                      </ProtectedRoute>
                    }
                  />
                  <Route path="/index.html" element={<Navigate to="/" replace />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </AuthProvider>
            </BrowserRouter>
          </QueryClientProvider>
        </MotionConfig>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
