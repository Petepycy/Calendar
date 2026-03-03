import { useNavigate } from "react-router-dom";
import {
  Brain,
  Bell,
  MessageSquare,
  BarChart3,
  ArrowRight,
  CheckCircle,
  Calendar,
  Bot,
  Zap,
  Shield,
  Sparkles,
  Users,
  ChevronRight,
  AlertCircle,
  CalendarCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Navbar
// ─────────────────────────────────────────────────────────────────────────────

function Navbar() {
  const navigate = useNavigate();
  return (
    <nav className="sticky top-0 z-50 border-b border-slate-200/60 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 shadow-md">
            <CalendarCheck className="h-4 w-4 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-slate-900">CalendarAI</span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            className="text-slate-600 hover:text-slate-900"
            onClick={() => navigate("/login")}
          >
            Log in
          </Button>
          <Button
            className="gap-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md hover:from-indigo-700 hover:to-purple-700"
            onClick={() => navigate("/login")}
          >
            Get Started
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero Visual — chat → booking mockup
// ─────────────────────────────────────────────────────────────────────────────

function HeroMockup() {
  return (
    <div className="relative mx-auto w-full max-w-sm">
      {/* Glow ring behind card */}
      <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-indigo-400/25 to-purple-400/25 blur-2xl" />

      <div className="relative rounded-3xl border border-slate-200/80 bg-white/80 p-5 shadow-2xl backdrop-blur-sm">
        {/* Agent header */}
        <div className="mb-4 flex items-center gap-3 border-b border-slate-100 pb-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 shadow-sm">
            <Bot className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">CalendarAI Agent</p>
            <p className="text-xs text-emerald-600">● Online — ready to book</p>
          </div>
        </div>

        {/* Chat messages */}
        <div className="space-y-3">
          {/* User message */}
          <div className="flex justify-end">
            <div className="max-w-[78%] rounded-2xl rounded-tr-sm bg-indigo-600 px-3.5 py-2 text-sm text-white">
              Hi! I'd like to book Meeting Room A tomorrow at 3 PM.
            </div>
          </div>

          {/* AI thinking */}
          <div className="flex gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100">
              <Bot className="h-3.5 w-3.5 text-indigo-600" />
            </div>
            <div className="max-w-[78%] rounded-2xl rounded-tl-sm bg-slate-100 px-3.5 py-2 text-sm text-slate-600">
              Checking availability for tomorrow…
            </div>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-2 py-0.5">
            <div className="h-px flex-1 bg-slate-100" />
            <Badge className="border-indigo-200 bg-indigo-50 text-xs text-indigo-600">
              <Sparkles className="mr-1 h-2.5 w-2.5" /> AI processing
            </Badge>
            <div className="h-px flex-1 bg-slate-100" />
          </div>

          {/* Booking confirmed card */}
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5">
            <div className="mb-2 flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-emerald-600" />
              <span className="text-xs font-semibold text-emerald-700">Booking Confirmed</span>
            </div>
            <p className="text-sm font-semibold text-slate-800">Meeting Room A</p>
            <p className="text-xs text-slate-500">Tomorrow · 3:00 PM – 4:00 PM</p>
            <div className="mt-2.5 flex items-center gap-2">
              <div className="flex h-5 w-5 items-center justify-center rounded bg-indigo-600">
                <Calendar className="h-2.5 w-2.5 text-white" />
              </div>
              <p className="text-xs text-indigo-600">Added to calendar automatically</p>
            </div>
          </div>
        </div>
      </div>

      {/* Floating badges */}
      <div className="absolute -right-3 -top-3 flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 shadow-lg">
        <CheckCircle className="h-3.5 w-3.5" />
        Automated
      </div>
      <div className="absolute -bottom-3 -left-3 flex items-center gap-1.5 rounded-full border border-purple-200 bg-white px-3 py-1.5 text-xs font-medium text-purple-700 shadow-lg">
        <Sparkles className="h-3.5 w-3.5" />
        AI-powered
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Bento Card
// ─────────────────────────────────────────────────────────────────────────────

interface BentoCardProps {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  description: string;
  className?: string;
  children?: React.ReactNode;
}

function BentoCard({ icon, iconBg, title, description, className, children }: BentoCardProps) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white/60 p-6 shadow-sm backdrop-blur-sm",
        "transition-all duration-300 hover:-translate-y-1 hover:shadow-xl",
        className
      )}
    >
      {/* Hover glow */}
      <div className="pointer-events-none absolute inset-0 rounded-3xl opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-to-br from-indigo-50/50 to-purple-50/50" />

      <div className={cn("relative mb-4 flex h-12 w-12 items-center justify-center rounded-2xl", iconBg)}>
        {icon}
      </div>
      <h3 className="relative mb-2 text-lg font-bold text-slate-900">{title}</h3>
      <p className="relative text-sm leading-relaxed text-slate-500">{description}</p>
      {children && <div className="relative">{children}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Co-Pilot Calendar Mockup
// ─────────────────────────────────────────────────────────────────────────────

function CalendarMockup() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];

  type EventType = "ai" | "attention";
  const events: { day: number; row: number; label: string; type: EventType }[] = [
    { day: 0, row: 0, label: "Team Sync", type: "ai" },
    { day: 1, row: 1, label: "Client Call", type: "attention" },
    { day: 2, row: 0, label: "Room B Booking", type: "ai" },
    { day: 3, row: 2, label: "Workshop", type: "ai" },
    { day: 4, row: 1, label: "VIP Meeting", type: "attention" },
    { day: 0, row: 3, label: "Meeting A", type: "ai" },
    { day: 2, row: 4, label: "Review Session", type: "ai" },
    { day: 1, row: 4, label: "Rush Booking", type: "attention" },
  ];

  const rows = 5;
  const hours = ["9 AM", "10 AM", "11 AM", "12 PM", "1 PM"];

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600">
            <Calendar className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-slate-800">Week of March 10</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
            <Sparkles className="h-2.5 w-2.5" /> AI Handled
          </span>
          <span className="flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
            <Bell className="h-2.5 w-2.5" /> Needs Review
          </span>
        </div>
      </div>

      {/* Grid */}
      <div className="p-4">
        {/* Day labels */}
        <div className="mb-2 ml-10 grid grid-cols-5 gap-1.5">
          {days.map((d) => (
            <div key={d} className="text-center text-xs font-semibold uppercase tracking-wider text-slate-400">
              {d}
            </div>
          ))}
        </div>

        {/* Rows */}
        <div className="space-y-1.5">
          {Array.from({ length: rows }).map((_, ri) => (
            <div key={ri} className="flex items-center gap-1.5">
              <div className="w-9 shrink-0 text-right text-xs text-slate-400">{hours[ri]}</div>
              <div className="grid flex-1 grid-cols-5 gap-1.5">
                {days.map((_, di) => {
                  const ev = events.find((e) => e.day === di && e.row === ri);
                  if (ev) {
                    return (
                      <div
                        key={di}
                        className={cn(
                          "rounded-lg px-1.5 py-1 text-xs font-medium leading-tight truncate",
                          ev.type === "ai"
                            ? "border border-indigo-200 bg-indigo-50 text-indigo-700"
                            : "border border-orange-200 bg-orange-50 text-orange-700"
                        )}
                      >
                        {ev.label}
                      </div>
                    );
                  }
                  return (
                    <div
                      key={di}
                      className="h-7 rounded-lg bg-slate-50 transition-colors hover:bg-indigo-50/50"
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer stats */}
      <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 bg-slate-50">
        {[
          { label: "AI handled", value: "6", color: "text-indigo-600" },
          { label: "Needs review", value: "2", color: "text-orange-600" },
          { label: "Response time", value: "< 3s", color: "text-emerald-600" },
        ].map((s) => (
          <div key={s.label} className="px-4 py-2.5 text-center">
            <p className={cn("text-base font-black", s.color)}>{s.value}</p>
            <p className="text-xs text-slate-400">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main LandingPage
// ─────────────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-gradient-to-b from-slate-50 via-white to-slate-50 font-sans">
      {/* ── Ambient background orbs ── */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-60 left-1/4 h-[700px] w-[700px] rounded-full bg-purple-400/10 blur-3xl" />
        <div className="absolute top-1/3 -right-32 h-[600px] w-[600px] rounded-full bg-blue-400/10 blur-3xl" />
        <div className="absolute bottom-1/4 -left-20 h-[500px] w-[500px] rounded-full bg-indigo-400/10 blur-3xl" />
        <div className="absolute bottom-10 right-1/3 h-[350px] w-[350px] rounded-full bg-violet-400/10 blur-3xl" />
      </div>

      <Navbar />

      {/* ══════════════════════════════════════════════════════════════════════
          HERO
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="relative mx-auto max-w-7xl px-4 pb-20 pt-24 sm:px-6">
        <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-2">
          {/* Left — copy */}
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-200/80 bg-indigo-50 px-4 py-1.5 text-sm font-medium text-indigo-700 shadow-sm">
              <Sparkles className="h-3.5 w-3.5" />
              AI-Powered Booking Management
            </div>

            <h1 className="mb-6 text-5xl font-extrabold leading-[1.1] tracking-tight text-slate-900 sm:text-6xl">
              Your Business,{" "}
              <span className="bg-gradient-to-r from-indigo-600 via-purple-600 to-violet-600 bg-clip-text text-transparent">
                Managed by AI.
              </span>{" "}
              Perfected by You.
            </h1>

            <p className="mb-8 max-w-lg text-lg leading-relaxed text-slate-500">
              The ultimate booking system for businesses without a booking system. Let our AI
              handle scheduling on Telegram, answer client questions, and seamlessly hand over
              the conversation to you when a human touch is needed.
            </p>

            <div className="flex flex-wrap gap-3">
              <Button
                size="lg"
                className="gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg hover:from-indigo-700 hover:to-purple-700"
                onClick={() => navigate("/login")}
              >
                Start Free Trial
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="gap-2 border-slate-300 text-slate-700 hover:bg-slate-50"
                onClick={() => navigate("/calendar")}
              >
                See a Live Demo
              </Button>
            </div>

            {/* Trust pills */}
            <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2">
              {["No credit card required", "Setup in 5 minutes", "Cancel anytime"].map((t) => (
                <div key={t} className="flex items-center gap-1.5 text-sm text-slate-500">
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                  {t}
                </div>
              ))}
            </div>
          </div>

          {/* Right — hero visual */}
          <div className="flex justify-center lg:justify-end">
            <HeroMockup />
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          SOCIAL PROOF BAR
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="relative border-y border-slate-100 bg-white/70 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            {[
              { value: "94%", label: "Requests handled by AI" },
              { value: "< 4s", label: "Average response time" },
              { value: "24/7", label: "Always-on availability" },
              { value: "0", label: "Missed bookings" },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <p className="text-3xl font-black text-slate-900">{s.value}</p>
                <p className="mt-0.5 text-sm text-slate-500">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          FEATURES — BENTO GRID
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6">
        {/* Section header */}
        <div className="mb-14 text-center">
          <Badge className="mb-4 border-purple-200 bg-purple-50 text-purple-700">Features</Badge>
          <h2 className="text-4xl font-extrabold text-slate-900 sm:text-5xl">
            Everything your business needs,{" "}
            <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              nothing it doesn't.
            </span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-slate-500">
            Powerful tools designed for the real world of small business.
          </p>
        </div>

        {/* Bento grid */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">

          {/* ── Row 1 ── */}

          {/* Knowledge Base — wide */}
          <BentoCard
            className="md:col-span-2"
            iconBg="bg-indigo-100"
            icon={<Brain className="h-6 w-6 text-indigo-600" />}
            title="Custom Knowledge Base"
            description="Train your AI on your own rules and resources. Define what's off-limits, set business hours, add your FAQs — the agent knows exactly what it can and cannot do."
          >
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              {[
                "Business hours & rules",
                "Custom FAQ entries",
                "Resource definitions",
                "Booking policies",
                "Pricing & services",
                "Special instructions",
              ].map((item) => (
                <div key={item} className="flex items-center gap-2 text-xs text-slate-500">
                  <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                  {item}
                </div>
              ))}
            </div>
          </BentoCard>

          {/* Human Escalation — narrow */}
          <BentoCard
            iconBg="bg-orange-100"
            icon={<Bell className="h-6 w-6 text-orange-600" />}
            title="Human Escalation"
            description="Steps aside when you need to step in. If the AI is uncertain, it instantly alerts a human admin — without the customer noticing a thing."
          >
            <div className="mt-4 space-y-2">
              <div className="rounded-xl border border-orange-100 bg-orange-50 p-3 text-xs text-orange-700">
                🚨 Unusual request detected — escalating to admin
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-700">
                ✅ Admin reviewed — booking approved
              </div>
            </div>
          </BentoCard>

          {/* ── Row 2 ── */}

          {/* Telegram — narrow */}
          <BentoCard
            iconBg="bg-blue-100"
            icon={<MessageSquare className="h-6 w-6 text-blue-600" />}
            title="Telegram Integration"
            description="Customers book directly through natural conversation. No apps to install, no forms to fill — just a chat that turns into a confirmed reservation."
          >
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
                <Zap className="h-3.5 w-3.5 shrink-0" />
                Instant booking confirmations
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
                <Shield className="h-3.5 w-3.5 shrink-0" />
                Works with existing Telegram account
              </div>
            </div>
          </BentoCard>

          {/* Daily Briefings — wide */}
          <BentoCard
            className="md:col-span-2"
            iconBg="bg-purple-100"
            icon={<BarChart3 className="h-6 w-6 text-purple-600" />}
            title="Daily Briefings"
            description="Your day, summarized. Get a morning digest of upcoming appointments, new bookings, and the most common customer questions — so you're always in the loop."
          >
            <div className="mt-5 grid grid-cols-3 gap-3">
              {[
                { label: "Bookings today", value: "12", color: "text-indigo-700", bg: "bg-indigo-50" },
                { label: "Avg response", value: "4s", color: "text-emerald-700", bg: "bg-emerald-50" },
                { label: "AI handled", value: "94%", color: "text-purple-700", bg: "bg-purple-50" },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className={cn("rounded-2xl p-3 text-center shadow-sm", stat.bg)}
                >
                  <p className={cn("text-2xl font-black", stat.color)}>{stat.value}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{stat.label}</p>
                </div>
              ))}
            </div>
          </BentoCard>

          {/* ── Row 3 — accent cards ── */}
          {[
            {
              icon: <Users className="h-5 w-5 text-violet-600" />,
              bg: "bg-violet-100",
              title: "Role-based Access",
              text: "Admins see everything. Members see only their own bookings.",
            },
            {
              icon: <Shield className="h-5 w-5 text-teal-600" />,
              bg: "bg-teal-100",
              title: "Business Rule Engine",
              text: "Enforce booking gaps, time limits, and operating hours automatically.",
            },
            {
              icon: <CalendarCheck className="h-5 w-5 text-indigo-600" />,
              bg: "bg-indigo-100",
              title: "Calendar Sync",
              text: "Export any view to Google Calendar, Outlook, or subscribe via webcal://.",
            },
          ].map(({ icon, bg, title, text }) => (
            <div
              key={title}
              className="group relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white/60 p-5 shadow-sm backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
            >
              <div className={cn("mb-3 flex h-10 w-10 items-center justify-center rounded-xl", bg)}>
                {icon}
              </div>
              <p className="mb-1.5 text-sm font-bold text-slate-900">{title}</p>
              <p className="text-xs leading-relaxed text-slate-500">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          CO-PILOT SECTION
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="relative mx-auto max-w-7xl px-4 pb-24 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-br from-slate-50 to-white p-8 shadow-sm lg:p-14">
          {/* subtle grid texture */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(99,102,241,1) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,1) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />

          <div className="relative grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
            {/* Text */}
            <div>
              <Badge className="mb-4 border-indigo-200 bg-indigo-50 text-indigo-700">
                AI Co-Pilot
              </Badge>
              <h2 className="mb-5 text-4xl font-extrabold leading-tight text-slate-900 sm:text-5xl">
                AI-driven.{" "}
                <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                  Human-controlled.
                </span>
              </h2>
              <p className="mb-6 text-lg leading-relaxed text-slate-500">
                The calendar isn't just a grid — it's an intelligent dashboard. Your AI agent
                handles routine bookings silently, while flagging anything unusual for your
                personal review. You stay in control without being buried in notifications.
              </p>

              <ul className="space-y-3.5">
                {[
                  {
                    icon: <CheckCircle className="h-4 w-4 text-emerald-500" />,
                    text: "Automatic confirmation for standard booking requests",
                  },
                  {
                    icon: <AlertCircle className="h-4 w-4 text-orange-500" />,
                    text: "Instant admin alerts for unusual or complex requests",
                  },
                  {
                    icon: <Shield className="h-4 w-4 text-indigo-500" />,
                    text: "Role-based access: admins see all, members see their own",
                  },
                  {
                    icon: <Users className="h-4 w-4 text-purple-500" />,
                    text: "Multi-tenant architecture for agencies and growing teams",
                  },
                ].map(({ icon, text }) => (
                  <li key={text} className="flex items-center gap-3 text-sm text-slate-600">
                    {icon}
                    {text}
                  </li>
                ))}
              </ul>

              <Button
                className="mt-8 gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md hover:from-indigo-700 hover:to-purple-700"
                onClick={() => navigate("/login")}
              >
                Explore the Dashboard
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Calendar mockup */}
            <CalendarMockup />
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          BOTTOM CTA
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="relative mx-auto max-w-7xl px-4 pb-24 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-purple-700 p-12 text-center shadow-2xl lg:p-20">
          {/* Decorative circles */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-white/5" />
            <div className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-white/5" />
            <div className="absolute left-1/2 top-0 h-px w-1/2 bg-white/10" />
          </div>

          <div className="relative">
            <div className="mb-6 flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 shadow-xl backdrop-blur-sm">
                <Zap className="h-8 w-8 text-white" />
              </div>
            </div>

            <h2 className="mb-4 text-4xl font-extrabold text-white lg:text-5xl">
              Ready to put your booking process on autopilot?
            </h2>
            <p className="mx-auto mb-8 max-w-2xl text-lg text-indigo-200">
              Join businesses handling hundreds of bookings per week — with full visibility and
              control, minus the manual work.
            </p>

            <Button
              size="lg"
              className="bg-white px-10 font-bold text-indigo-700 shadow-xl hover:bg-indigo-50"
              onClick={() => navigate("/login")}
            >
              Join Now — It's Free
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>

            <p className="mt-4 text-sm text-indigo-300">
              No credit card required · Cancel anytime
            </p>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          FOOTER
      ══════════════════════════════════════════════════════════════════════ */}
      <footer className="border-t border-slate-200 bg-white/70 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-purple-600">
                <CalendarCheck className="h-3 w-3 text-white" />
              </div>
              <span className="text-sm font-bold text-slate-800">CalendarAI</span>
            </div>

            <p className="text-xs text-slate-400">
              © {new Date().getFullYear()} CalendarAI. All rights reserved.
            </p>

            <div className="flex gap-6">
              {["Privacy", "Terms", "Contact"].map((link) => (
                <a
                  key={link}
                  href="#"
                  className="text-xs text-slate-400 transition-colors hover:text-slate-700"
                >
                  {link}
                </a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
