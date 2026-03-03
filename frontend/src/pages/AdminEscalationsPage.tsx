import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, Pencil, AlertTriangle, Bot, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Escalation {
  id: string;
  user_name: string | null;
  user_email: string | null;
  contact_id: string | null;
  contact_channel: string | null;
  contact_channel_id: string | null;
  contact_display_name: string | null;
  status: string;
  trigger_type: string;
  rule_code: string | null;
  reason: string;
  summary: string | null;
  booking_draft: { resource_id: number; start: string; end: string } | null;
  admin_comment: string | null;
  modified_draft: { resource_id: number; start: string; end: string } | null;
  created_at: string;
  decided_at: string | null;
}

const CHANNEL_LABELS: Record<string, { label: string; emoji: string }> = {
  telegram: { label: "Telegram", emoji: "✈️" },
  whatsapp: { label: "WhatsApp", emoji: "💬" },
  sms: { label: "SMS", emoji: "📱" },
  web: { label: "Web", emoji: "🌐" },
};

type DecisionType = "approved" | "rejected" | "modified";

const RULE_LABELS: Record<string, string> = {
  too_long: "Za długa rezerwacja (>4h)",
  outside_hours: "Poza godzinami pracy",
  gap_too_short: "Za mała przerwa (<15 min)",
};

export default function AdminEscalationsPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<Escalation | null>(null);
  const [decision, setDecision] = useState<DecisionType>("approved");
  const [comment, setComment] = useState("");
  const [modStart, setModStart] = useState("");
  const [modEnd, setModEnd] = useState("");
  const [modResource, setModResource] = useState("");
  const [expandedSummary, setExpandedSummary] = useState<string | null>(null);

  const { data: escalations = [], isLoading } = useQuery<Escalation[]>({
    queryKey: ["escalations"],
    queryFn: async () => {
      const { data } = await api.get("/api/escalations");
      return data;
    },
    enabled: isAdmin,
    refetchInterval: 15_000,
  });

  const decideMutation = useMutation({
    mutationFn: async ({
      id,
      decision,
      comment,
      modified_draft,
    }: {
      id: string;
      decision: string;
      comment?: string;
      modified_draft?: object;
    }) => {
      const { data } = await api.patch(`/api/escalations/${id}`, {
        decision,
        comment: comment || undefined,
        modified_draft: modified_draft || undefined,
      });
      return data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
      queryClient.invalidateQueries({ queryKey: ["escalations-pending-count"] });
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      toast.success(
        vars.decision === "approved"
          ? "Rezerwacja zatwierdzona"
          : vars.decision === "rejected"
            ? "Eskalacja odrzucona"
            : "Propozycja modyfikacji wysłana do użytkownika"
      );
      closeDialog();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail ?? "Wystąpił błąd");
    },
  });

  const openDecision = (esc: Escalation, type: DecisionType) => {
    setSelected(esc);
    setDecision(type);
    setComment("");
    // Pre-fill the draft fields from the existing draft (or empty for admin to fill)
    const draft = esc.booking_draft;
    setModStart(draft?.start ?? "");
    setModEnd(draft?.end ?? "");
    setModResource(draft ? String(draft.resource_id) : "");
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setSelected(null);
  };

  const handleSubmit = () => {
    if (!selected) return;
    const payload: any = { id: selected.id, decision, comment };

    // For "modified": always send the modified_draft so admin can adjust times
    if (decision === "modified") {
      payload.modified_draft = {
        resource_id: parseInt(modResource) || selected.booking_draft?.resource_id,
        start: modStart,
        end: modEnd,
      };
    }

    // For "approved" without an existing draft: admin fills in the draft
    if (decision === "approved" && !selected.booking_draft && modResource && modStart && modEnd) {
      payload.modified_draft = {
        resource_id: parseInt(modResource),
        start: modStart,
        end: modEnd,
      };
    }

    decideMutation.mutate(payload);
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("pl-PL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  const toggleSummary = (id: string) =>
    setExpandedSummary((prev) => (prev === id ? null : id));

  // Determine if admin needs to fill a draft (no existing draft)
  const needsDraftInput =
    !selected?.booking_draft && (decision === "approved" || decision === "modified");

  if (!isAdmin) {
    return <p className="text-muted-foreground">Brak dostępu — wymagana rola administratora.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Eskalacje</h2>
        <p className="text-muted-foreground">Zapytania wymagające decyzji administratora</p>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Ładowanie...</p>
      ) : escalations.length === 0 ? (
        <p className="text-muted-foreground">Brak eskalacji.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Użytkownik</TableHead>
              <TableHead>Typ</TableHead>
              <TableHead>Powód / Podsumowanie AI</TableHead>
              <TableHead>Rezerwacja</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Akcje</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {escalations.map((esc) => (
              <TableRow key={esc.id}>
                <TableCell className="whitespace-nowrap text-sm">
                  {formatDate(esc.created_at)}
                </TableCell>
                <TableCell>
                  <div>
                    {esc.contact_channel ? (
                      <>
                        <p className="font-medium text-sm">
                          {CHANNEL_LABELS[esc.contact_channel]?.emoji}{" "}
                          {esc.contact_display_name ?? esc.contact_channel_id}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {CHANNEL_LABELS[esc.contact_channel]?.label} · {esc.contact_channel_id}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-medium text-sm">{esc.user_name ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{esc.user_email}</p>
                      </>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <Badge variant={esc.trigger_type === "rule" ? "secondary" : "outline"}>
                      {esc.trigger_type === "rule" ? (
                        <><AlertTriangle className="mr-1 h-3 w-3" />Reguła</>
                      ) : (
                        <><Bot className="mr-1 h-3 w-3" />LLM</>
                      )}
                    </Badge>
                    {esc.rule_code && (
                      <span className="text-xs text-muted-foreground">
                        {RULE_LABELS[esc.rule_code] ?? esc.rule_code}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="max-w-[280px]">
                  <p className="text-sm truncate">{esc.reason}</p>
                  {esc.summary && (
                    <div className="mt-1">
                      <button
                        onClick={() => toggleSummary(esc.id)}
                        className="flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        {expandedSummary === esc.id ? (
                          <><ChevronUp className="h-3 w-3" />Ukryj podsumowanie AI</>
                        ) : (
                          <><ChevronDown className="h-3 w-3" />Podsumowanie AI</>
                        )}
                      </button>
                      {expandedSummary === esc.id && (
                        <p className="mt-1 text-xs text-muted-foreground rounded-md bg-muted p-2 whitespace-pre-wrap">
                          {esc.summary}
                        </p>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  {esc.booking_draft ? (
                    <>
                      Zasób {esc.booking_draft.resource_id}<br />
                      {formatDate(esc.booking_draft.start)}<br />
                      → {formatDate(esc.booking_draft.end)}
                    </>
                  ) : (
                    <span className="text-muted-foreground italic">brak draftu</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      esc.status === "pending" ? "default"
                        : esc.status === "approved" ? "default"
                          : "secondary"
                    }
                  >
                    {esc.status === "pending" ? "Oczekuje"
                      : esc.status === "approved" ? "Zatwierdzona"
                        : esc.status === "rejected" ? "Odrzucona"
                          : "Zmodyfikowana"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {esc.status === "pending" ? (
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => openDecision(esc, "approved")}
                        title="Zatwierdź"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openDecision(esc, "rejected")}
                        title="Odrzuć"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openDecision(esc, "modified")}
                        title="Zaproponuj zmianę"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {esc.admin_comment && `"${esc.admin_comment}"`}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision === "approved"
                ? "Zatwierdź rezerwację"
                : decision === "rejected"
                  ? "Odrzuć rezerwację"
                  : "Zaproponuj modyfikację terminu"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Show existing draft if present */}
            {selected?.booking_draft && (
              <div className="rounded-md bg-muted p-3 text-sm">
                <p className="font-medium mb-1 text-muted-foreground text-xs uppercase tracking-wide">
                  Oryginalny wniosek
                </p>
                <p>Zasób: {selected.booking_draft.resource_id}</p>
                <p>Od: {formatDate(selected.booking_draft.start)}</p>
                <p>Do: {formatDate(selected.booking_draft.end)}</p>
              </div>
            )}

            {/* Draft input fields — for "modified" always shown, for "approved" shown only when no draft */}
            {(decision === "modified" || needsDraftInput) && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {decision === "modified" ? "Zaproponowane terminy" : "Szczegóły rezerwacji"}
                </p>
                <div>
                  <label className="text-xs text-muted-foreground">ID zasobu (sali)</label>
                  <Input
                    type="number"
                    value={modResource}
                    onChange={(e) => setModResource(e.target.value)}
                    placeholder="np. 1"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Od (ISO 8601)</label>
                  <Input
                    value={modStart}
                    onChange={(e) => setModStart(e.target.value)}
                    placeholder="2026-03-05T10:00:00+01:00"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Do (ISO 8601)</label>
                  <Input
                    value={modEnd}
                    onChange={(e) => setModEnd(e.target.value)}
                    placeholder="2026-03-05T11:00:00+01:00"
                  />
                </div>
                {decision === "modified" && (
                  <p className="text-xs text-muted-foreground">
                    Użytkownik zobaczy tę propozycję w czacie i będzie mógł ją zatwierdzić lub odrzucić.
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="text-sm font-medium">Komentarz (opcjonalnie)</label>
              <Input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Wiadomość do użytkownika..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Anuluj
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={decideMutation.isPending}
              variant={decision === "rejected" ? "destructive" : "default"}
            >
              {decision === "approved"
                ? "Zatwierdź"
                : decision === "rejected"
                  ? "Odrzuć"
                  : "Wyślij propozycję"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
