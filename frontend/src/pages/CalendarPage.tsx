import { useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import {
  ExternalLink,
  Download,
  CalendarPlus,
  Trash2,
  RefreshCw,
  Copy,
  Check,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useBookings } from "@/hooks/use-bookings";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

interface SelectedEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  resourceName?: string;
  canExport: boolean;
  canCancel: boolean;
}

interface ViewRange {
  start: Date;
  end: Date;
  viewType: string;
}

// ---------------------------------------------------------------------------
// Helpers – single event export
// ---------------------------------------------------------------------------

function formatGoogleDate(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function toGoogleCalUrl(event: SelectedEvent): string {
  const start = formatGoogleDate(event.start);
  const end = formatGoogleDate(event.end);
  const text = encodeURIComponent(event.title);
  const details = event.resourceName
    ? encodeURIComponent(`Zasób: ${event.resourceName}`)
    : "";
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${start}/${end}&details=${details}`;
}

function toOutlookUrl(event: SelectedEvent): string {
  const start = encodeURIComponent(event.start);
  const end = encodeURIComponent(event.end);
  const subject = encodeURIComponent(event.title);
  return `https://outlook.live.com/calendar/0/deeplink/compose?subject=${subject}&startdt=${start}&enddt=${end}&path=/calendar/action/compose&rru=addevent`;
}

function downloadIcs(event: SelectedEvent) {
  const start = formatGoogleDate(event.start);
  const end = formatGoogleDate(event.end);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CalendarAI//PL",
    "BEGIN:VEVENT",
    `UID:${event.id}@calendarai`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${event.title}`,
  ];
  if (event.resourceName) lines.push(`DESCRIPTION:Zasób: ${event.resourceName}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `wydarzenie-${event.id}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const datePart = s.toLocaleDateString("pl-PL", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const startTime = s.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  const endTime = e.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  return `${datePart}, ${startTime} – ${endTime}`;
}

// ---------------------------------------------------------------------------
// Helpers – view range label
// ---------------------------------------------------------------------------

function formatViewLabel(range: ViewRange): string {
  const { start, end, viewType } = range;
  if (viewType.includes("Day")) {
    return start.toLocaleDateString("pl-PL", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
  if (viewType.includes("Month")) {
    // FullCalendar month view start is the first visible day (may be in previous month)
    // Use mid-month date to get the correct month label
    const mid = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
    return mid.toLocaleDateString("pl-PL", { year: "numeric", month: "long" });
  }
  // Week
  const endDay = new Date(end.getTime() - 1);
  const sameMonth = start.getMonth() === endDay.getMonth();
  if (sameMonth) {
    return `${start.getDate()}–${endDay.toLocaleDateString("pl-PL", {
      day: "numeric",
      month: "long",
      year: "numeric",
    })}`;
  }
  return `${start.toLocaleDateString("pl-PL", { day: "numeric", month: "short" })} – ${endDay.toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" })}`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CalendarPage() {
  const { data: bookings, isLoading } = useBookings();
  const { isAdmin } = useAuth();
  const calendarRef = useRef<InstanceType<typeof FullCalendar>>(null);

  // Event click dialog
  const [selected, setSelected] = useState<SelectedEvent | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Sync dialog
  const [syncOpen, setSyncOpen] = useState(false);
  const [viewRange, setViewRange] = useState<ViewRange | null>(null);
  const [calToken, setCalToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [icsDownloading, setIcsDownloading] = useState(false);

  const queryClient = useQueryClient();

  // Cancel mutation
  const cancelMutation = useMutation({
    mutationFn: (bookingId: string) => api.delete(`/api/bookings/${bookingId}`),
    onSuccess: () => {
      toast.success("Rezerwacja anulowana");
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      setSelected(null);
      setConfirmCancel(false);
    },
    onError: () => {
      toast.error("Nie udało się anulować rezerwacji");
      setConfirmCancel(false);
    },
  });

  // Calendar events
  const events = useMemo(
    () =>
      (bookings ?? []).map((b: any) => {
        if (isAdmin) {
          return {
            id: String(b.id),
            title: b.resourceName ?? `Zasób ${b.resource_id}`,
            start: b.start,
            end: b.end,
            backgroundColor: "#3b82f6",
            borderColor: "#2563eb",
            extendedProps: { resourceName: b.resourceName, canExport: true, canCancel: true },
          };
        }
        if (b.is_mine) {
          return {
            id: String(b.id),
            title: b.resourceName ?? `Zasób ${b.resource_id}`,
            start: b.start,
            end: b.end,
            backgroundColor: "#10b981",
            borderColor: "#059669",
            extendedProps: { resourceName: b.resourceName, canExport: true, canCancel: true },
          };
        }
        return {
          id: String(b.id),
          title: "Zajęte",
          start: b.start,
          end: b.end,
          backgroundColor: "#9ca3af",
          borderColor: "#6b7280",
          extendedProps: { canExport: false, canCancel: false },
        };
      }),
    [bookings, isAdmin]
  );

  // FullCalendar callbacks
  const handleEventClick = (info: any) => {
    const { canExport, canCancel, resourceName } = info.event.extendedProps;
    if (!canExport && !canCancel) return;
    setSelected({
      id: info.event.id,
      title: info.event.title,
      start: info.event.startStr,
      end: info.event.endStr,
      resourceName,
      canExport: !!canExport,
      canCancel: !!canCancel,
    });
    setConfirmCancel(false);
  };

  const handleDatesSet = (info: { start: Date; end: Date; view: { type: string } }) => {
    setViewRange({ start: info.start, end: info.end, viewType: info.view.type });
  };

  // ---------------------------------------------------------------------------
  // Sync helpers
  // ---------------------------------------------------------------------------

  const ensureCalToken = async (): Promise<string> => {
    if (calToken) return calToken;
    setTokenLoading(true);
    try {
      const { data } = await api.get<{ cal_token: string }>("/api/auth/calendar-token");
      setCalToken(data.cal_token);
      return data.cal_token;
    } finally {
      setTokenLoading(false);
    }
  };

  const buildWebcalUrl = (token: string): string =>
    `webcal://${API_URL.replace(/^https?:\/\//, "")}/api/calendar/ics?cal_token=${token}`;

  const handleOpenWebcal = async () => {
    try {
      const token = await ensureCalToken();
      window.open(buildWebcalUrl(token), "_blank");
    } catch {
      toast.error("Nie udało się pobrać tokenu subskrypcji");
    }
  };

  const handleCopyWebcalUrl = async () => {
    try {
      const token = await ensureCalToken();
      await navigator.clipboard.writeText(buildWebcalUrl(token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Nie udało się skopiować URL");
    }
  };

  const handleDownloadViewIcs = async () => {
    if (!viewRange) return;
    setIcsDownloading(true);
    try {
      const from = viewRange.start.toISOString().split("T")[0];
      // end in FullCalendar is exclusive — subtract 1 day to get the last visible day
      const endAdj = new Date(viewRange.end.getTime() - 24 * 60 * 60 * 1000);
      const to = endAdj.toISOString().split("T")[0];
      const { data } = await api.get("/api/calendar/ics", {
        params: { from, to },
        responseType: "blob",
      });
      const url = URL.createObjectURL(data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "calendar.ics";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Nie udało się pobrać pliku ICS");
    } finally {
      setIcsDownloading(false);
    }
  };

  const subtitle = isAdmin
    ? "Pełny widok rezerwacji z detalami"
    : "Twoje rezerwacje (zielone) i zajęte terminy innych (szare)";

  const viewLabel = viewRange ? formatViewLabel(viewRange) : "";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Kalendarz</h2>
          <p className="text-muted-foreground">{subtitle}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-2"
          onClick={() => setSyncOpen(true)}
        >
          <RefreshCw className="h-4 w-4" />
          Synchronizuj z kalendarzem
        </Button>
      </div>

      {isLoading ? (
        <div className="flex h-96 items-center justify-center text-muted-foreground">
          Ładowanie...
        </div>
      ) : (
        <div className="rounded-lg border bg-card p-4">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "dayGridMonth,timeGridWeek,timeGridDay",
            }}
            events={events}
            eventClick={handleEventClick}
            datesSet={handleDatesSet}
            eventCursor="pointer"
            nowIndicator
            allDaySlot={false}
            slotMinTime="07:00:00"
            slotMaxTime="21:00:00"
            height="auto"
            locale="pl"
            firstDay={1}
          />
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs text-muted-foreground px-1">
        {isAdmin ? (
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-blue-500" />
            Rezerwacja — kliknij aby eksportować lub anulować
          </span>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-emerald-500" />
              Moja rezerwacja — kliknij aby dodać do kalendarza
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-gray-400" />
              Zajęte
            </span>
          </>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Event click dialog                                                  */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent className="max-w-sm">
          {selected && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 mb-1">
                  <CalendarPlus className="h-5 w-5 text-primary" />
                  <DialogTitle>{selected.title}</DialogTitle>
                </div>
                <p className="text-sm text-muted-foreground">
                  {formatDateRange(selected.start, selected.end)}
                </p>
                {selected.resourceName && (
                  <p className="text-sm text-muted-foreground">
                    Zasób: {selected.resourceName}
                  </p>
                )}
              </DialogHeader>

              {selected.canExport && (
                <>
                  <p className="text-sm font-medium mt-2 mb-3">Dodaj do swojego kalendarza:</p>
                  <div className="flex flex-col gap-2">
                    <Button
                      variant="outline"
                      className="justify-start gap-2"
                      onClick={() => window.open(toGoogleCalUrl(selected), "_blank")}
                    >
                      <ExternalLink className="h-4 w-4" />
                      Google Calendar
                    </Button>
                    <Button
                      variant="outline"
                      className="justify-start gap-2"
                      onClick={() => window.open(toOutlookUrl(selected), "_blank")}
                    >
                      <ExternalLink className="h-4 w-4" />
                      Outlook / Microsoft 365
                    </Button>
                    <Button
                      variant="outline"
                      className="justify-start gap-2"
                      onClick={() => downloadIcs(selected)}
                    >
                      <Download className="h-4 w-4" />
                      Apple Calendar / telefon (.ics)
                    </Button>
                  </div>
                </>
              )}

              {selected.canCancel && (
                <div className="mt-4 border-t pt-4">
                  {!confirmCancel ? (
                    <Button
                      variant="destructive"
                      className="w-full gap-2"
                      onClick={() => setConfirmCancel(true)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Anuluj rezerwację
                    </Button>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-destructive">
                        Na pewno chcesz anulować tę rezerwację?
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Administrator zostanie powiadomiony. Operacja jest nieodwracalna.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex-1"
                          onClick={() => setConfirmCancel(false)}
                          disabled={cancelMutation.isPending}
                        >
                          Nie, wróć
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="flex-1"
                          onClick={() => cancelMutation.mutate(selected.id)}
                          disabled={cancelMutation.isPending}
                        >
                          {cancelMutation.isPending ? (
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          ) : (
                            "Tak, anuluj"
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <DialogFooter>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelected(null);
                    setConfirmCancel(false);
                  }}
                >
                  Zamknij
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      {/* Calendar sync dialog                                                */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={syncOpen} onOpenChange={setSyncOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <RefreshCw className="h-5 w-5 text-primary" />
              <DialogTitle>Synchronizacja z kalendarzem</DialogTitle>
            </div>
            {viewLabel && (
              <p className="text-sm text-muted-foreground">
                Aktualny widok:{" "}
                <span className="font-medium text-foreground">{viewLabel}</span>
              </p>
            )}
          </DialogHeader>

          <div className="space-y-5 pt-1">
            {/* One-time ICS download */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Pobierz widok jako plik ICS</p>
              <p className="text-xs text-muted-foreground">
                {isAdmin
                  ? "Eksportuje wszystkie rezerwacje z aktualnego widoku (miesiąc / tydzień / dzień)."
                  : "Eksportuje Twoje rezerwacje z aktualnego widoku."}
              </p>
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={handleDownloadViewIcs}
                disabled={!viewRange || icsDownloading}
              >
                {icsDownloading ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Pobierz .ics ({viewLabel || "brak widoku"})
              </Button>
            </div>

            {/* Live subscription */}
            <div className="space-y-2 border-t pt-4">
              <p className="text-sm font-medium">Subskrypcja na żywo (webcal://)</p>
              <p className="text-xs text-muted-foreground">
                Dodaj stały link do swojej aplikacji kalendarza (Google Calendar, Apple Calendar,
                Outlook). Kalendarz będzie{" "}
                <span className="font-medium">automatycznie aktualizowany</span> — pokazuje
                zawsze pełny zakres rezerwacji, nie tylko aktualny widok.
                {isAdmin ? " Zawiera wszystkie rezerwacje." : " Zawiera tylko Twoje rezerwacje."}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 gap-2"
                  onClick={handleOpenWebcal}
                  disabled={tokenLoading}
                >
                  {tokenLoading ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <ExternalLink className="h-4 w-4" />
                  )}
                  Otwórz w kalendarzu
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleCopyWebcalUrl}
                  disabled={tokenLoading}
                  title="Kopiuj URL subskrypcji"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Link jest ważny przez 1 rok. W razie potrzeby wygeneruj nowy klikając ponownie.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setSyncOpen(false)}>
              Zamknij
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
