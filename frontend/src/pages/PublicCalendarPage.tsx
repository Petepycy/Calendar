import { useState, useRef, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import { Calendar, LogIn, Search, Send, Bot, User as UserIcon } from "lucide-react";
import { usePublicBookings } from "@/hooks/use-public-bookings";
import {
  sendPublicChatMessage,
  getOrCreateAnonymousId,
  type ChatMessage,
} from "@/lib/chat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export default function PublicCalendarPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [slugInput, setSlugInput] = useState(searchParams.get("slug") ?? "");
  const [activeSlug, setActiveSlug] = useState(searchParams.get("slug") ?? "");

  const { data: bookings, isLoading, isError } = usePublicBookings(activeSlug || null);

  // Chat state
  const [threadId] = useState(() => crypto.randomUUID());
  const [anonymousId] = useState(() => getOrCreateAnonymousId());
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "agent",
      content:
        "Cześć! Jestem asystentem rezerwacji. Mogę pomóc sprawdzić dostępność i zaplanować termin. Aby potwierdzić rezerwację, będzie potrzebne logowanie.",
      timestamp: new Date().toISOString(),
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const events = (bookings ?? []).map((b) => ({
    id: String(b.id),
    title: "Zajęte",
    start: b.start,
    end: b.end,
    backgroundColor: "#9ca3af",
    borderColor: "#6b7280",
  }));

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const slug = slugInput.trim().toLowerCase();
    setActiveSlug(slug);
    if (slug) navigate(`/calendar?slug=${slug}`, { replace: true });
  };

  const handleChatSend = async () => {
    const text = chatInput.trim();
    if (!text || sending) return;

    if (!activeSlug) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "agent",
          content: "Najpierw podaj slug firmy powyżej, aby aktywować czat.",
          timestamp: new Date().toISOString(),
        },
      ]);
      return;
    }

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setSending(true);

    try {
      const reply = await sendPublicChatMessage(text, threadId, anonymousId, activeSlug);
      setMessages((prev) => [...prev, reply]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "agent",
          content: "Błąd połączenia z agentem. Sprawdź, czy backend jest uruchomiony.",
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const pendingLogin = messages.some((m) => m.requiresLogin);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur dark:bg-gray-900/80">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2 font-semibold">
            <Calendar className="h-5 w-5 text-primary" />
            CalendarAI
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => navigate("/login")}
          >
            <LogIn className="h-4 w-4" />
            Zaloguj się
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        {/* Slug search */}
        <div className="rounded-lg border bg-white p-4 shadow-sm dark:bg-gray-900">
          <p className="mb-3 text-sm font-medium text-muted-foreground">
            Wpisz slug firmy, aby zobaczyć jej dostępność i porozmawiać z agentem:
          </p>
          <form onSubmit={handleSearch} className="flex gap-2">
            <Input
              value={slugInput}
              onChange={(e) => setSlugInput(e.target.value)}
              placeholder="np. moja-firma"
              className="max-w-xs"
            />
            <Button type="submit" size="sm" className="gap-2">
              <Search className="h-4 w-4" />
              Pokaż
            </Button>
          </form>
          {isError && (
            <p className="mt-2 text-sm text-destructive">
              Nie znaleziono firmy o tym slug-u.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Calendar */}
          <div className="rounded-lg border bg-white p-4 shadow-sm dark:bg-gray-900">
            {activeSlug ? (
              <>
                <div className="mb-4">
                  <h2 className="text-xl font-bold">Dostępność — {activeSlug}</h2>
                  <p className="text-sm text-muted-foreground">
                    Widok tylko do odczytu. Zaloguj się, aby rezerwować.
                  </p>
                </div>
                {isLoading ? (
                  <div className="flex h-64 items-center justify-center text-muted-foreground">
                    Ładowanie...
                  </div>
                ) : (
                  <FullCalendar
                    plugins={[dayGridPlugin, timeGridPlugin]}
                    initialView="timeGridWeek"
                    headerToolbar={{
                      left: "prev,next today",
                      center: "title",
                      right: "dayGridMonth,timeGridWeek,timeGridDay",
                    }}
                    events={events}
                    nowIndicator
                    allDaySlot={false}
                    slotMinTime="07:00:00"
                    slotMaxTime="21:00:00"
                    height="auto"
                    locale="pl"
                    firstDay={1}
                    editable={false}
                    selectable={false}
                  />
                )}
                <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="h-3 w-3 rounded-sm bg-gray-400" />
                  Termin zajęty
                </div>
              </>
            ) : (
              <div className="flex h-64 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                <Calendar className="h-12 w-12 opacity-30" />
                <p>Podaj slug firmy, aby zobaczyć kalendarz.</p>
              </div>
            )}
          </div>

          {/* Chat */}
          <div
            className="flex flex-col overflow-hidden rounded-lg border bg-white shadow-sm dark:bg-gray-900"
            style={{ minHeight: "500px" }}
          >
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <Bot className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Asystent rezerwacji</span>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-4 overflow-auto p-4">
              {messages.map((msg) => (
                <div key={msg.id}>
                  <div
                    className={cn(
                      "flex gap-3",
                      msg.role === "user" && "flex-row-reverse"
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                        msg.role === "agent"
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary"
                      )}
                    >
                      {msg.role === "agent" ? (
                        <Bot className="h-4 w-4" />
                      ) : (
                        <UserIcon className="h-4 w-4" />
                      )}
                    </div>
                    <div
                      className={cn(
                        "max-w-[80%] rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap",
                        msg.role === "agent"
                          ? "bg-muted text-foreground"
                          : "bg-primary text-primary-foreground"
                      )}
                    >
                      {msg.content}
                    </div>
                  </div>

                  {/* Login CTA after agent signals requires_login */}
                  {msg.requiresLogin && (
                    <div className="ml-11 mt-3 space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                      <p className="text-sm font-medium">
                        Zaloguj się, aby sfinalizować rezerwację
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Rezerwacja zostanie potwierdzona zaraz po zalogowaniu.
                      </p>
                      <Button
                        size="sm"
                        className="w-full gap-2"
                        onClick={() => {
                          window.location.href = `${API_URL}/api/auth/google`;
                        }}
                      >
                        <LogIn className="h-4 w-4" />
                        Zaloguj przez Google
                      </Button>
                    </div>
                  )}
                </div>
              ))}

              {sending && (
                <div className="flex gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="rounded-lg bg-muted px-4 py-2.5 text-sm text-muted-foreground">
                    <span className="animate-pulse">Pisze...</span>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t p-3">
              {pendingLogin ? (
                <p className="py-1 text-center text-xs text-muted-foreground">
                  Zaloguj się powyżej, aby kontynuować
                </p>
              ) : (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleChatSend();
                  }}
                >
                  <Input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder={
                      activeSlug ? "Napisz wiadomość..." : "Najpierw podaj slug firmy..."
                    }
                    disabled={sending}
                    className="flex-1"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={sending || !chatInput.trim()}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
