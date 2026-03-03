import { useState, useEffect } from "react";
import { toast } from "sonner";
import { MessageCircle, ExternalLink } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function SettingsPage() {
  const { user, refetch } = useAuth();
  const [telegramId, setTelegramId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user?.telegram_chat_id != null) {
      setTelegramId(String(user.telegram_chat_id));
    }
  }, [user?.telegram_chat_id]);

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
