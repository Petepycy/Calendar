import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth";
import ProtectedRoute from "@/components/ProtectedRoute";
import DashboardLayout from "@/layouts/DashboardLayout";
import PublicCalendarPage from "@/pages/PublicCalendarPage";
import CalendarPage from "@/pages/CalendarPage";
import AgentPlaygroundPage from "@/pages/AgentPlaygroundPage";
import KnowledgeBasePage from "@/pages/KnowledgeBasePage";
import SettingsPage from "@/pages/SettingsPage";
import LoginPage from "@/pages/LoginPage";
import AuthCallbackPage from "@/pages/AuthCallbackPage";
import OnboardingPage from "@/pages/OnboardingPage";
import AdminResourcesPage from "@/pages/AdminResourcesPage";
import AdminEscalationsPage from "@/pages/AdminEscalationsPage";

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Toaster richColors position="top-right" />
          <Routes>
            {/* Public routes — no auth required */}
            <Route path="/" element={<PublicCalendarPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />

            {/* Protected routes */}
            <Route element={<ProtectedRoute />}>
              <Route path="/onboarding" element={<OnboardingPage />} />
              <Route path="/app" element={<DashboardLayout />}>
                <Route index element={<CalendarPage />} />
                <Route path="agent" element={<AgentPlaygroundPage />} />
                <Route path="knowledge" element={<KnowledgeBasePage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="admin/resources" element={<AdminResourcesPage />} />
                <Route path="admin/escalations" element={<AdminEscalationsPage />} />
              </Route>
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
