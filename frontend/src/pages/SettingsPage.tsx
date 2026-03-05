import { useState, useEffect } from "react";
import { toast } from "sonner";
import { MessageCircle, Mail, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const PROVIDER_PRESETS: Record<string, { imap_server: string; imap_port: number; smtp_server: string; smtp_port: number }> = {
  outlook: { imap_server: "outlook.office365.com", imap_port: 993, smtp_server: "smtp.office365.com", smtp_port: 587 },
};

interface EmailConfig {
  id: string;
  email_provider: string;
  email_address: string;
  imap_server: string | null;
  imap_port: number;
  smtp_server: string | null;
  smtp_port: number;
  use_ssl: boolean;
  is_active: boolean;
  last_checked_at: string | null;
  last_error: string | null;
}

export default function SettingsPage() {
  const { user, isAdmin, refetch } = useAuth();
  const [telegramId, setTelegramId] = useState("");
  const [saving, setSaving] = useState(false);

  // Email config state
  const [provider, setProvider] = useState("custom");
  const [emailForm, setEmailForm] = useState({
    email_address: "",
    imap_server: "",
    imap_port: 993,
    smtp_server: "",
    smtp_port: 587,
    password: "",
    use_ssl: true,
    is_active: false,
  });
  const [emailConfig, setEmailConfig] = useState<EmailConfig | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [hasExistingConfig, setHasExistingConfig] = useState(false);
  const [gmailConnecting, setGmailConnecting] = useState(false);

  const loadEmailConfig = () => {
    setEmailLoading(true);
    api
      .get<EmailConfig>("/api/email-config")
      .then(({ data }) => {
        setEmailConfig(data);
        setHasExistingConfig(true);

        if (data.email_provider === "gmail") {
          setProvider("gmail");
        } else if (data.imap_server === "outlook.office365.com") {
          setProvider("outlook");
        } else {
          setProvider("custom");
        }

        setEmailForm({
          email_address: data.email_address,
          imap_server: data.imap_server || "",
          imap_port: data.imap_port,
          smtp_server: data.smtp_server || "",
          smtp_port: data.smtp_port,
          password: "",
          use_ssl: data.use_ssl,
          is_active: data.is_active,
        });
      })
      .catch(() => {
        setEmailConfig(null);
        setHasExistingConfig(false);
      })
      .finally(() => setEmailLoading(false));
  };

  // Check for Gmail OAuth callback result
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmailStatus = params.get("gmail");
    if (gmailStatus === "connected") {
      toast.success("Gmail connected successfully!");
      window.history.replaceState({}, "", window.location.pathname);
      if (isAdmin) loadEmailConfig();
    } else if (gmailStatus === "error") {
      toast.error("Gmail connection failed. Please try again.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (user?.telegram_chat_id != null) {
      setTelegramId(String(user.telegram_chat_id));
    }
  }, [user?.telegram_chat_id]);

  // Load existing email config on mount (admin only)
  useEffect(() => {
    if (!isAdmin) return;
    loadEmailConfig();
  }, [isAdmin]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const parsed = telegramId.trim() === "" ? null : Number(telegramId.trim());
      if (parsed !== null && isNaN(parsed)) {
        toast.error("Telegram chat ID musi być liczbą");
        return;
      }
      await api.patch("/api/auth/me", { telegram_chat_id: parsed });
      await refetch();
      toast.success("Ustawienia zapisane");
    } catch {
      toast.error("Błąd przy zapisywaniu");
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await api.patch("/api/auth/me", { telegram_chat_id: null });
      setTelegramId("");
      await refetch();
      toast.success("Telegram chat ID usunięty");
    } catch {
      toast.error("Błąd przy usuwaniu");
    } finally {
      setSaving(false);
    }
  };

  const handleProviderChange = (value: string) => {
    setProvider(value);
    if (value in PROVIDER_PRESETS) {
      const preset = PROVIDER_PRESETS[value];
      setEmailForm((f) => ({
        ...f,
        imap_server: preset.imap_server,
        imap_port: preset.imap_port,
        smtp_server: preset.smtp_server,
        smtp_port: preset.smtp_port,
        use_ssl: true,
      }));
    }
  };

  const handleGmailConnect = async () => {
    setGmailConnecting(true);
    try {
      const { data } = await api.get<{ auth_url: string }>("/api/email-config/gmail/auth");
      window.location.href = data.auth_url;
    } catch {
      toast.error("Could not start Gmail connection");
      setGmailConnecting(false);
    }
  };

  const handleTestConnection = async () => {
    if (provider === "gmail") {
      setTesting(true);
      try {
        const { data } = await api.post<{ ok: boolean; error: string | null }>("/api/email-config/gmail/test");
        if (data.ok) {
          toast.success("Gmail API connection OK!");
        } else {
          toast.error(data.error || "Gmail test failed");
        }
      } catch {
        toast.error("Gmail config not found — connect first");
      } finally {
        setTesting(false);
      }
      return;
    }

    if (!emailForm.email_address || !emailForm.password) {
      toast.error("Podaj adres email i hasło");
      return;
    }
    setTesting(true);
    try {
      const { data } = await api.post<{ imap_ok: boolean; smtp_ok: boolean; error: string | null }>(
        "/api/email-config/test",
        emailForm
      );
      if (data.imap_ok && data.smtp_ok) {
        toast.success("Połączenie IMAP i SMTP OK!");
      } else {
        toast.error(data.error || "Test nie powiódł się");
      }
    } catch {
      toast.error("Błąd przy testowaniu połączenia");
    } finally {
      setTesting(false);
    }
  };

  const handleEmailSave = async () => {
    if (provider === "gmail") {
      if (!hasExistingConfig || emailConfig?.email_provider !== "gmail") {
        toast.error("Connect with Google first");
        return;
      }
      setEmailSaving(true);
      try {
        const { data } = await api.patch<EmailConfig>("/api/email-config/gmail", {
          is_active: emailForm.is_active,
        });
        setEmailConfig(data);
        toast.success("Settings saved");
      } catch {
        toast.error("Failed to save settings");
      } finally {
        setEmailSaving(false);
      }
      return;
    }

    if (!emailForm.email_address || !emailForm.password) {
      if (!hasExistingConfig) {
        toast.error("Podaj adres email i hasło");
        return;
      }
      if (!emailForm.password) {
        toast.error("Podaj hasło (wymagane przy każdym zapisie)");
        return;
      }
    }
    setEmailSaving(true);
    try {
      const { data } = await api.put<EmailConfig>("/api/email-config", emailForm);
      setEmailConfig(data);
      setHasExistingConfig(true);
      toast.success("Konfiguracja email zapisana");
    } catch {
      toast.error("Błąd przy zapisywaniu konfiguracji email");
    } finally {
      setEmailSaving(false);
    }
  };

  const handleEmailDelete = async () => {
    setEmailSaving(true);
    try {
      await api.delete("/api/email-config");
      setEmailConfig(null);
      setHasExistingConfig(false);
      setEmailForm({
        email_address: "",
        imap_server: "",
        imap_port: 993,
        smtp_server: "",
        smtp_port: 587,
        password: "",
        use_ssl: true,
        is_active: false,
      });
      setProvider("custom");
      toast.success("Konfiguracja email usunięta");
    } catch {
      toast.error("Błąd przy usuwaniu");
    } finally {
      setEmailSaving(false);
    }
  };

  const relativeTime = (iso: string | null) => {
    if (!iso) return null;
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "przed chwilą";
    if (mins < 60) return `${mins} min temu`;
    const hours = Math.floor(mins / 60);
    return `${hours} godz. temu`;
  };

  const isGmailConnected = emailConfig?.email_provider === "gmail" && hasExistingConfig;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">Manage your account preferences</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-primary" />
            <CardTitle>Telegram Notifications</CardTitle>
          </div>
          <CardDescription>
            Set your Telegram chat ID to receive escalation notifications and booking decisions directly on Telegram.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/40 p-4 text-sm space-y-1">
            <p className="font-medium">How to find your Telegram chat ID:</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>
                Open Telegram and search for{" "}
                <span className="font-mono text-foreground">@userinfobot</span>
              </li>
              <li>Send it any message — it will reply with your numeric ID</li>
              <li>Paste that number below and save</li>
            </ol>
          </div>

          <form onSubmit={handleSave} className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <label className="text-sm font-medium">
                Telegram Chat ID
                {user?.telegram_chat_id != null && (
                  <span className="ml-2 text-xs text-green-600 font-normal">● Connected</span>
                )}
              </label>
              <Input
                type="number"
                value={telegramId}
                onChange={(e) => setTelegramId(e.target.value)}
                placeholder="e.g. 123456789"
              />
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
            {user?.telegram_chat_id != null && (
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={handleClear}
              >
                Clear
              </Button>
            )}
          </form>

          {user?.telegram_chat_id != null && (
            <p className="text-xs text-muted-foreground">
              Current ID: <span className="font-mono">{user.telegram_chat_id}</span>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Email Integration — admin only */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              <CardTitle>Email Integration</CardTitle>
            </div>
            <CardDescription>
              Connect your business email so the AI agent can read and reply to incoming messages automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {emailLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </div>
            ) : (
              <>
                {/* Status alerts */}
                {emailConfig?.last_error && (
                  <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">Connection error</p>
                      <p>{emailConfig.last_error}</p>
                    </div>
                  </div>
                )}
                {emailConfig?.last_checked_at && !emailConfig.last_error && (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    Last checked: {relativeTime(emailConfig.last_checked_at)}
                  </div>
                )}

                {/* Provider preset */}
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Select value={provider} onValueChange={handleProviderChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gmail">Gmail (OAuth)</SelectItem>
                      <SelectItem value="outlook">Outlook / Microsoft 365 (IMAP)</SelectItem>
                      <SelectItem value="custom">Custom (IMAP/SMTP)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Gmail OAuth flow */}
                {provider === "gmail" && (
                  <div className="space-y-3">
                    {isGmailConnected ? (
                      <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                        <div>
                          <p className="font-medium">Gmail connected</p>
                          <p>{emailConfig.email_address}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-md border bg-muted/40 p-4 text-sm space-y-3">
                        <p className="text-muted-foreground">
                          Connect your Gmail account via Google OAuth. No app password needed.
                        </p>
                        <Button onClick={handleGmailConnect} disabled={gmailConnecting}>
                          {gmailConnecting ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Connecting...
                            </>
                          ) : (
                            <>
                              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                              </svg>
                              Connect with Google
                            </>
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* IMAP/SMTP form fields — only for non-Gmail providers */}
                {provider !== "gmail" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Email address</Label>
                      <Input
                        type="email"
                        value={emailForm.email_address}
                        onChange={(e) => setEmailForm((f) => ({ ...f, email_address: e.target.value }))}
                        placeholder="inbox@yourbusiness.com"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Password</Label>
                      <Input
                        type="password"
                        value={emailForm.password}
                        onChange={(e) => setEmailForm((f) => ({ ...f, password: e.target.value }))}
                        placeholder={hasExistingConfig ? "••••••••" : "App password or email password"}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>IMAP server</Label>
                      <Input
                        value={emailForm.imap_server}
                        onChange={(e) => setEmailForm((f) => ({ ...f, imap_server: e.target.value }))}
                        placeholder="imap.example.com"
                        disabled={provider !== "custom"}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>IMAP port</Label>
                      <Input
                        type="number"
                        value={emailForm.imap_port}
                        onChange={(e) => setEmailForm((f) => ({ ...f, imap_port: Number(e.target.value) }))}
                        disabled={provider !== "custom"}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>SMTP server</Label>
                      <Input
                        value={emailForm.smtp_server}
                        onChange={(e) => setEmailForm((f) => ({ ...f, smtp_server: e.target.value }))}
                        placeholder="smtp.example.com"
                        disabled={provider !== "custom"}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>SMTP port</Label>
                      <Input
                        type="number"
                        value={emailForm.smtp_port}
                        onChange={(e) => setEmailForm((f) => ({ ...f, smtp_port: Number(e.target.value) }))}
                        disabled={provider !== "custom"}
                      />
                    </div>
                  </div>
                )}

                {/* Enable toggle */}
                <div className="flex items-center gap-3">
                  <Switch
                    checked={emailForm.is_active}
                    onCheckedChange={(checked) => setEmailForm((f) => ({ ...f, is_active: checked }))}
                  />
                  <Label>Enable email monitoring</Label>
                </div>

                {/* Action buttons */}
                <div className="flex gap-3">
                  {(provider !== "gmail" || isGmailConnected) && (
                    <Button variant="outline" onClick={handleTestConnection} disabled={testing}>
                      {testing ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Testing...
                        </>
                      ) : (
                        "Test Connection"
                      )}
                    </Button>
                  )}
                  {(provider !== "gmail" || isGmailConnected) && (
                    <Button onClick={handleEmailSave} disabled={emailSaving}>
                      {emailSaving ? "Saving..." : "Save"}
                    </Button>
                  )}
                  {hasExistingConfig && (
                    <Button variant="destructive" onClick={handleEmailDelete} disabled={emailSaving}>
                      Delete
                    </Button>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Your account details (managed via Google)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Name</span>
            <span className="font-medium">{user?.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium">{user?.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Role</span>
            <span className="font-medium capitalize">{user?.role}</span>
          </div>
          {user?.tenant_name && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Workspace</span>
              <span className="font-medium">{user.tenant_name}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
