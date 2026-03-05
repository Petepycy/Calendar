import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Calendar, Bot, BookOpen, Settings, Shield, LogOut, AlertTriangle, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

export default function DashboardLayout() {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();

  const { data: pendingCount } = useQuery({
    queryKey: ["escalations-pending-count"],
    queryFn: async () => {
      const { data } = await api.get<{ count: number }>("/api/escalations/pending-count");
      return data.count;
    },
    enabled: isAdmin,
    refetchInterval: 30_000,
  });

  // Members only see Calendar + Agent
  const memberItems = [
    { to: "/app", icon: Calendar, label: "Kalendarz", badge: 0 },
    { to: "/app/agent", icon: Bot, label: "Agent", badge: 0 },
  ];

  const adminItems = [
    { to: "/app", icon: Calendar, label: "Kalendarz", badge: 0 },
    { to: "/app/agent", icon: Bot, label: "Agent", badge: 0 },
    { to: "/app/knowledge", icon: BookOpen, label: "Baza wiedzy", badge: 0 },
    { to: "/app/settings", icon: Settings, label: "Ustawienia", badge: 0 },
    { to: "/app/admin/resources", icon: Shield, label: "Zasoby", badge: 0 },
    {
      to: "/app/admin/escalations",
      icon: AlertTriangle,
      label: "Eskalacje",
      badge: pendingCount ?? 0,
    },
    { to: "/app/admin/email-inbox", icon: Mail, label: "Email Inbox", badge: 0 },
  ];

  const navItems = isAdmin ? adminItems : memberItems;

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="hidden w-64 shrink-0 border-r bg-sidebar md:flex md:flex-col">
        <div className="flex h-14 items-center border-b px-6">
          <Calendar className="mr-2 h-5 w-5 text-primary" />
          <span className="text-lg font-semibold">CalendarAI</span>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map(({ to, icon: Icon, label, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/app"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )
              }
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{label}</span>
              {badge > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                  {badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t px-4 py-3">
          {user && (
            <div className="flex items-center gap-3">
              {user.picture_url ? (
                <img
                  src={user.picture_url}
                  alt={user.name}
                  className="h-8 w-8 rounded-full"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                  {user.name?.charAt(0)?.toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">{user.role}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={handleLogout} title="Wyloguj">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-between border-b px-6">
          <h1 className="text-sm font-medium text-muted-foreground">
            {user?.tenant_name ?? "Dashboard"}
          </h1>
        </header>
        <div className="flex-1 overflow-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
