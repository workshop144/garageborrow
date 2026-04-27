import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { Suspense, lazy, useEffect, useMemo } from "react";
import { AuthProvider, useAuth } from "./lib/auth/AuthContext";
import { ProtectedRoute } from "./lib/auth/ProtectedRoute";
import { ThemeProvider } from "./lib/theme/ThemeContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { createQueryClient } from "./lib/queryClient";
import { setAuthTokenProvider } from "./lib/api";

// Pegboard is the authenticated home route, so it stays eager. Every other
// page is route-split — they load on first navigation, not at initial paint.
// Keeps the entry chunk small enough for the Lighthouse perf gate.
import Pegboard from "./pages/Pegboard";
import { AdminGuard } from "./components/Admin/AdminGuard";

const Login = lazy(() => import("./pages/Login"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const ToolDetail = lazy(() => import("./pages/ToolDetail"));
const MyStuff = lazy(() => import("./pages/MyStuff"));
const Members = lazy(() => import("./pages/Members"));
const ProfileSettings = lazy(() => import("./pages/ProfileSettings"));
const NotificationsInbox = lazy(() => import("./pages/NotificationsInbox"));
const Donate = lazy(() => import("./pages/Donate"));
const MyDonations = lazy(() => import("./pages/MyDonations"));
const PayItForward = lazy(() => import("./pages/PayItForward"));
const Wishlist = lazy(() => import("./pages/Wishlist"));
const WishlistDetail = lazy(() => import("./pages/WishlistDetail"));
const AdminWishlist = lazy(() => import("./pages/admin/AdminWishlist"));
const OutRightNow = lazy(() => import("./pages/admin/OutRightNow"));
const Inventory = lazy(() => import("./pages/admin/Inventory"));
const MembersAdmin = lazy(() => import("./pages/admin/MembersAdmin"));
const Donations = lazy(() => import("./pages/admin/Donations"));
const Incidents = lazy(() => import("./pages/admin/Incidents"));
const Activity = lazy(() => import("./pages/admin/Activity"));
const Settings = lazy(() => import("./pages/admin/Settings"));
const LegalTerms = lazy(() => import("./pages/LegalTerms"));
const LegalPrivacy = lazy(() => import("./pages/LegalPrivacy"));
const Offline = lazy(() => import("./pages/Offline"));
const NotFound = lazy(() => import("./pages/NotFound"));

function RouteFallback(): JSX.Element {
  return <div className="p-6 text-sm opacity-60">Loading…</div>;
}

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
                <Suspense fallback={<RouteFallback />}>
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
                      path="/wishlist"
                      element={
                        <ProtectedRoute>
                          <Wishlist />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/wishlist/:id"
                      element={
                        <ProtectedRoute>
                          <WishlistDetail />
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
                      path="/admin/wishlist"
                      element={
                        <ProtectedRoute>
                          <AdminGuard>
                            <AdminWishlist />
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
                </Suspense>
              </AuthProvider>
            </BrowserRouter>
          </QueryClientProvider>
        </MotionConfig>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
