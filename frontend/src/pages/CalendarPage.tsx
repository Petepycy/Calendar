import { useMemo, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import { ExternalLink, Download, CalendarPlus, Trash2 } from "lucide-react";
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

interface SelectedEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  resourceName?: string;
  canExport: boolean;
  canCancel: boolean;
}

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

  const blob = new Blob([lines.join("\r\n")], {
    type: "text/calendar;charset=utf-8",
  });
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
  const startTime = s.toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const endTime = e.toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${datePart}, ${startTime} – ${endTime}`;
}

export default function CalendarPage() {
  const { data: bookings, isLoading } = useBookings();
  const { isAdmin, user } = useAuth();
  const [selected, setSelected] = useState<SelectedEvent | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const queryClient = useQueryClient();

  const cancelMutation = useMutation({
    mutationFn: (bookingId: string) =>
      api.delete(`/api/bookings/${bookingId}`),
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

  const subtitle = isAdmin
    ? "Pełny widok rezerwacji z detalami"
    : "Twoje rezerwacje (zielone) i zajęte terminy innych (szare)";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Kalendarz</h2>
        <p className="text-muted-foreground">{subtitle}</p>
      </div>

      {isLoading ? (
        <div className="flex h-96 items-center justify-center text-muted-foreground">
          Ładowanie...
        </div>
      ) : (
        <div className="rounded-lg border bg-card p-4">
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "dayGridMonth,timeGridWeek,timeGridDay",
            }}
            events={events}
            eventClick={handleEventClick}
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
            Rezerwacja
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
                  <p className="text-sm font-medium mt-2 mb-3">
                    Dodaj do swojego kalendarza:
                  </p>
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
                  onClick={() => { setSelected(null); setConfirmCancel(false); }}
                >
                  Zamknij
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
