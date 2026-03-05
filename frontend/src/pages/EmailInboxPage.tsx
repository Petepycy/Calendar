import { useState, useEffect } from "react";
import { Mail, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

interface ProcessedEmail {
  id: string;
  from_address: string;
  subject: string;
  body_preview: string | null;
  status: "replied" | "escalated" | "error";
  ai_reply: string | null;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  replied: { label: "Replied", variant: "default" },
  escalated: { label: "Escalated", variant: "secondary" },
  error: { label: "Error", variant: "destructive" },
};

export default function EmailInboxPage() {
  const [emails, setEmails] = useState<ProcessedEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ProcessedEmail[]>("/api/email-config/inbox?limit=50")
      .then(({ data }) => setEmails(data))
      .catch(() => setEmails([]))
      .finally(() => setLoading(false));
  }, []);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("pl-PL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Email Inbox</h2>
        <p className="text-muted-foreground">History of emails processed by the AI agent</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            <CardTitle>Processed Emails</CardTitle>
          </div>
          <CardDescription>
            Incoming emails and their AI-generated responses
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : emails.length === 0 ? (
            <p className="text-sm text-muted-foreground">No processed emails yet.</p>
          ) : (
            <div className="divide-y">
              {emails.map((email) => {
                const statusCfg = STATUS_CONFIG[email.status] || STATUS_CONFIG.error;
                const isExpanded = expandedId === email.id;
                return (
                  <div key={email.id} className="py-3">
                    <button
                      className="flex w-full items-start gap-3 text-left"
                      onClick={() => setExpandedId(isExpanded ? null : email.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{email.from_address}</span>
                          <Badge variant={statusCfg.variant} className="shrink-0">
                            {statusCfg.label}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{email.subject || "(no subject)"}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">{formatDate(email.created_at)}</span>
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="mt-3 space-y-3 pl-0">
                        {email.body_preview && (
                          <div className="rounded-md border bg-muted/30 p-3">
                            <p className="text-xs font-medium text-muted-foreground mb-1">Original email:</p>
                            <p className="text-sm whitespace-pre-wrap">{email.body_preview}</p>
                          </div>
                        )}
                        {email.ai_reply && (
                          <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                            <p className="text-xs font-medium text-primary mb-1">AI reply:</p>
                            <p className="text-sm whitespace-pre-wrap">{email.ai_reply}</p>
                          </div>
                        )}
                        {email.status === "escalated" && (
                          <p className="text-sm text-orange-600">This email was escalated to a human admin.</p>
                        )}
                        {email.status === "error" && (
                          <p className="text-sm text-red-600">An error occurred while processing this email.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
