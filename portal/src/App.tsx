import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "./lib/auth";
import { CustomerProvider } from "./lib/customer";
import { Shell } from "./components/Shell";
import { Spinner } from "./components/ui";
import { Login, Register } from "./pages/Auth";
import { Dashboard } from "./pages/Dashboard";
import { Browse } from "./pages/Browse";
import { Bookings } from "./pages/Bookings";
import { Rentals } from "./pages/Rentals";
import { Payments } from "./pages/Payments";
import { Profile } from "./pages/Profile";

import { AdminAuthProvider, useAdminAuth } from "./lib/adminAuth";
import { ToastProvider } from "./components/admin/AdminUi";
import { AdminShell } from "./components/admin/AdminShell";
import { AdminLogin } from "./pages/admin/AdminLogin";
import { AdminDashboard } from "./pages/admin/AdminDashboard";
import { AdminBookings } from "./pages/admin/AdminBookings";
import { AdminCustomers } from "./pages/admin/AdminCustomers";
import { AdminInventory } from "./pages/admin/AdminInventory";
import { AdminGames } from "./pages/admin/AdminGames";
import { AdminPayments } from "./pages/admin/AdminPayments";
import { AdminSecurity } from "./pages/admin/AdminSecurity";

function Protected({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Shell>{children}</Shell>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <Spinner />;
  if (session) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// The admin console is mounted once for /admin/* so the shell (and its alert badge)
// stays alive across navigation; each screen renders inside it.
function AdminArea() {
  const { authenticated } = useAdminAuth();
  if (!authenticated) return <Navigate to="/admin/login" replace />;
  return (
    <ToastProvider>
      <AdminShell>
        <Routes>
          <Route index element={<AdminDashboard />} />
          <Route path="bookings" element={<AdminBookings />} />
          <Route path="customers" element={<AdminCustomers />} />
          <Route path="inventory" element={<AdminInventory />} />
          <Route path="games" element={<AdminGames />} />
          <Route path="payments" element={<AdminPayments />} />
          <Route path="security" element={<AdminSecurity />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </AdminShell>
    </ToastProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <CustomerProvider>
        <AdminAuthProvider>
        <HashRouter>
          <Routes>
            <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
            <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
            <Route path="/" element={<Protected><Dashboard /></Protected>} />
            <Route path="/browse" element={<Protected><Browse /></Protected>} />
            <Route path="/bookings" element={<Protected><Bookings /></Protected>} />
            <Route path="/rentals" element={<Protected><Rentals /></Protected>} />
            <Route path="/payments" element={<Protected><Payments /></Protected>} />
            <Route path="/profile" element={<Protected><Profile /></Protected>} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin/*" element={<AdminArea />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
        </AdminAuthProvider>
      </CustomerProvider>
    </AuthProvider>
  );
}
