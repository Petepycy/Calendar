import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, ArrowRight, Users, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Mode = "choose" | "create" | "join";

export default function OnboardingPage() {
  const { user, refetch } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("choose");

  // Create state
  const [companyName, setCompanyName] = useState("");
  const [resourceName, setResourceName] = useState("Sala A");

  // Join state
  const [slug, setSlug] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) return;
    setLoading(true);
    setError("");
    try {
      await api.post("/api/tenants", {
        name: companyName.trim(),
        first_resource_name: resourceName.trim() || "Sala A",
      });
      await refetch();
      navigate("/app", { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.detail ?? "Wystąpił błąd. Spróbuj ponownie.");
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug.trim()) return;
    setLoading(true);
    setError("");
    try {
      await api.post("/api/tenants/join", { slug: slug.trim().toLowerCase() });
      await refetch();
      navigate("/app", { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.detail ?? "Nie znaleziono firmy o tym slug-u.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
      {mode === "choose" && (
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Building2 className="h-6 w-6" />
            </div>
            <CardTitle className="text-2xl">Witaj, {user?.name}!</CardTitle>
            <CardDescription>
              Utwórz nową firmę lub dołącz do istniejącej
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button
              className="w-full justify-between gap-2"
              onClick={() => setMode("create")}
            >
              <span className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Utwórz firmę
              </span>
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              className="w-full justify-between gap-2"
              onClick={() => setMode("join")}
            >
              <span className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Dołącz do firmy
              </span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {mode === "create" && (
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Building2 className="h-6 w-6" />
            </div>
            <CardTitle className="text-2xl">Nowa firma</CardTitle>
            <CardDescription>
              Zostaniesz administratorem tej firmy
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Nazwa firmy</label>
                <Input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="np. Moja Firma Sp. z o.o."
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium">Nazwa pierwszego zasobu</label>
                <Input
                  value={resourceName}
                  onChange={(e) => setResourceName(e.target.value)}
                  placeholder="np. Sala konferencyjna A"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Możesz dodać więcej zasobów później w panelu administracyjnym
                </p>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="flex-1"
                  onClick={() => { setMode("choose"); setError(""); }}
                >
                  Wstecz
                </Button>
                <Button
                  type="submit"
                  className="flex-1 gap-2"
                  disabled={loading || !companyName.trim()}
                >
                  {loading ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <>
                      Utwórz firmę
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {mode === "join" && (
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Users className="h-6 w-6" />
            </div>
            <CardTitle className="text-2xl">Dołącz do firmy</CardTitle>
            <CardDescription>
              Podaj slug firmy, do której chcesz dołączyć
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleJoin} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Slug firmy</label>
                <div className="relative mt-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="np. moja-firma"
                    className="pl-9"
                    required
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Slug znajdziesz w adresie kalendarza firmy
                </p>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="flex-1"
                  onClick={() => { setMode("choose"); setError(""); }}
                >
                  Wstecz
                </Button>
                <Button
                  type="submit"
                  className="flex-1 gap-2"
                  disabled={loading || !slug.trim()}
                >
                  {loading ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <>
                      Dołącz
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
