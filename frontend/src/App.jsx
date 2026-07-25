import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { SocketProvider } from "./contexts/SocketProvider";

// Layouts
import MainLayout from "./layouts/MainLayout";
import DashboardLayout from "./layouts/DashboardLayout";

// Guard
import ProtectedRoute from "./components/ProtectedRoute";

// Pages – Guest
import GuestHome from "./pages/Guest/GuestHome";
import LoginPage from "./pages/Guest/LoginPage";
import ParkingMap from "./pages/Guest/ParkingMap";
import ServiceList from "./pages/Guest/ServiceList";
import ServiceDetail from "./pages/Guest/ServiceDetail";
import PolicyList from "./pages/Guest/PolicyList";
import PolicyDetail from "./pages/Guest/PolicyDetail";
import OAuthCallback from "./pages/OAuthCallback";

// Pages - Kiosk
import KioskFlow from "./pages/Kiosk/KioskFlow";
import KioskOutFlow from "./pages/KioskOut/KioskOutFlow";

// Pages – Admin
import AdminDashboard from "./pages/Admin/Dashboard";
import VehicleManagement from "./pages/Admin/VehicleManagement";
import AdminProfile from "./pages/Admin/AdminProfile";
import ParkingLots from "./pages/Admin/ParkingLots";
import PricingManagement from "./pages/Admin/PricingManagement";
import AdminServiceManager from "./pages/Admin/AdminServiceManager";
import TicketPackages from "./pages/Admin/TicketPackages";
import AccountManagement from "./pages/Admin/AccountManagement";
import PolicyManagement from "./pages/Admin/PolicyManagement";
import SubscriptionManagement from "./pages/Admin/SubscriptionManagement";
import RevenueAnalytics from "./pages/Admin/RevenueAnalytics";

// Pages – Staff
import StaffDashboard from "./pages/Staff/Dashboard";
import StaffProfile from "./pages/Staff/StaffProfile";
import StaffSessionManagement from "./pages/Staff/SessionManagement";
import StaffAccountManagement from "./pages/Staff/AccountManagement";
import NotificationManagement from "./pages/Staff/NotificationManagement";
import LiveGridMonitor from "./pages/Staff/LiveGridMonitor";
import BookingManagement from "./pages/Staff/BookingManagement";

// Pages – Customer
import CustomerProfile from "./pages/Customer/CustomerProfile";
import Membership from "./pages/Customer/Membership";
import MembershipTransfers from "./pages/Customer/MembershipTransfers";
import MembershipTransferMarketplace from "./pages/Customer/MembershipTransferMarketplace";
import MyVehicles from "./pages/Customer/MyVehicles";
import WalletPage from "./pages/Wallet/WalletPage";
import ParkingHistory from "./pages/Customer/ParkingHistory";
import CustomerNotifications from "./pages/Customer/CustomerNotifications";
import BookingPage from "./pages/Customer/BookingPage";
import CreateBookingPage from "./pages/Customer/CreateBookingPage";

// Misc
import UnauthorizedPage from "./pages/UnauthorizedPage";

function RedirectOldWalletRoutes() {
  const location = useLocation();
  return <Navigate to={`/customer/wallet${location.search}`} replace />;
}

export default function App() {
  return (
    <SocketProvider>
      <BrowserRouter>
        <Routes>
          {/* ── Standalone Kiosk app ── */}
          <Route path="/kiosk/*" element={<KioskFlow />} />
          <Route path="/kiosk-out/*" element={<KioskOutFlow />} />
          {/* Typo Catchers */}
          <Route
            path="/kiost-out/*"
            element={<Navigate to="/kiosk-out" replace />}
          />
          <Route path="/kiost/*" element={<Navigate to="/kiosk" replace />} />

          {/* ── Public: Navbar + Footer ── */}
          <Route element={<MainLayout />}>
            <Route path="/" element={<GuestHome />} />
            <Route path="/parking-map" element={<ParkingMap />} />
            <Route path="/services" element={<ServiceList />} />
            <Route path="/services/:id" element={<ServiceDetail />} />
            <Route path="/policies" element={<PolicyList />} />
            <Route path="/policies/:slug" element={<PolicyDetail />} />
            <Route path="/policy" element={<Navigate to="/policies" replace />} />

            {/* Protected routes that use MainLayout (Light theme with top navbar) */}
            <Route
              path="/booking"
              element={
                <ProtectedRoute allowedRoles={["customer"]}>
                  <CreateBookingPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/membership"
              element={
                <ProtectedRoute allowedRoles={["customer"]}>
                  <Membership />
                </ProtectedRoute>
              }
            />
          </Route>

          {/* ── Standalone auth page ── */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/oauth/callback" element={<OAuthCallback />} />

          {/* ══════════════════════════════════════════
            ADMIN section — DashboardLayout chung
            Only the "admin" role can access this route
        ══════════════════════════════════════════ */}
          <Route
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/admin/dashboard" element={<AdminDashboard />} />
            <Route path="/admin/accounts" element={<AccountManagement />} />
            <Route
              path="/admin/vehicle-models"
              element={<VehicleManagement />}
            />
            <Route path="/admin/services" element={<AdminServiceManager />} />
            <Route path="/admin/policies" element={<PolicyManagement />} />
            <Route path="/admin/parking-lots" element={<ParkingLots />} />
            <Route path="/admin/pricing" element={<PricingManagement />} />
            <Route path="/admin/tickets" element={<TicketPackages />} />
            <Route path="/admin/subscriptions" element={<SubscriptionManagement />} />
            <Route path="/admin/revenue" element={<RevenueAnalytics />} />
            <Route path="/admin/profile" element={<AdminProfile />} />
            <Route
              path="/admin/notifications"
              element={<NotificationManagement />}
            />
            <Route
              path="/admin/notification-inbox"
              element={<CustomerNotifications contextRole="admin" />}
            />
          </Route>

          {/* ══════════════════════════════════════════
            STAFF section — DashboardLayout chung
            Only the "staff" role can access this route
        ══════════════════════════════════════════ */}
          <Route
            element={
              <ProtectedRoute allowedRoles={["staff"]}>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/staff/dashboard" element={<StaffDashboard />} />
            <Route
              path="/staff/accounts"
              element={<StaffAccountManagement />}
            />
            <Route
              path="/staff/sessions"
              element={<StaffSessionManagement />}
            />
            <Route path="/staff/profile" element={<StaffProfile />} />
            <Route
              path="/staff/notifications"
              element={<NotificationManagement />}
            />
            <Route
              path="/staff/notification-inbox"
              element={<CustomerNotifications contextRole="staff" />}
            />
            <Route path="/staff/live-grid" element={<LiveGridMonitor />} />
            <Route path="/staff/bookings" element={<BookingManagement />} />
            <Route path="/staff/subscriptions" element={<SubscriptionManagement />} />
            <Route path="/staff/tickets" element={<TicketPackages />} />
          </Route>

          {/* ── Customer section ── */}
          <Route
            element={
              <ProtectedRoute allowedRoles={["customer"]}>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/profile" element={<CustomerProfile />} />
            <Route
              path="/customer/membership-transfers"
              element={<MembershipTransfers />}
            />
            <Route
              path="/customer/membership-transfer-marketplace"
              element={<MembershipTransferMarketplace />}
            />
            <Route
              path="/customer/membership-transfer-marketplace/:transferId"
              element={<MembershipTransferMarketplace />}
            />
            <Route path="/customer/vehicles" element={<MyVehicles />} />
            <Route path="/customer/wallet" element={<WalletPage />} />
            <Route path="/customer/history" element={<ParkingHistory />} />
            <Route path="/customer/booking" element={<BookingPage />} />
            <Route
              path="/customer/notification-inbox"
              element={<CustomerNotifications />}
            />
            <Route
              path="/customer/notifications"
              element={<CustomerNotifications />}
            />
            <Route path="/wallet/*" element={<RedirectOldWalletRoutes />} />
          </Route>

          {/* ── 403 ── */}
          <Route path="/unauthorized" element={<UnauthorizedPage />} />
        </Routes>
      </BrowserRouter>
    </SocketProvider>
  );
}
