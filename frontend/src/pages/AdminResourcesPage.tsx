import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
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

interface Resource {
  id: number;
  name: string;
  capacity: number | null;
  description: string | null;
  is_active: boolean;
}

export default function AdminResourcesPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Resource | null>(null);
  const [form, setForm] = useState({ name: "", capacity: "", description: "" });

  const { data: resources = [], isLoading } = useQuery<Resource[]>({
    queryKey: ["resources-all"],
    queryFn: async () => {
      const { data } = await api.get("/api/resources/all");
      return data;
    },
    enabled: isAdmin,
  });

  const createMutation = useMutation({
    mutationFn: (body: { name: string; capacity?: number; description?: string }) =>
      api.post("/api/resources", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources-all"] });
      setDialogOpen(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: number; name?: string; capacity?: number; description?: string; is_active?: boolean }) =>
      api.patch(`/api/resources/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources-all"] });
      setDialogOpen(false);
      setEditing(null);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/resources/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["resources-all"] }),
  });

  const resetForm = () => setForm({ name: "", capacity: "", description: "" });

  const openCreate = () => {
    setEditing(null);
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (r: Resource) => {
    setEditing(r);
    setForm({
      name: r.name,
      capacity: r.capacity?.toString() ?? "",
      description: r.description ?? "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    const payload = {
      name: form.name,
      capacity: form.capacity ? parseInt(form.capacity) : undefined,
      description: form.description || undefined,
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleRestore = (r: Resource) => {
    updateMutation.mutate({ id: r.id, is_active: true });
  };

  if (!isAdmin) {
    return <p className="text-muted-foreground">Brak dostępu — wymagana rola administratora.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Zasoby</h2>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          Dodaj zasób
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Ładowanie...</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Nazwa</TableHead>
              <TableHead>Pojemność</TableHead>
              <TableHead>Opis</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Akcje</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {resources.map((r) => (
              <TableRow key={r.id} className={!r.is_active ? "opacity-50" : ""}>
                <TableCell>{r.id}</TableCell>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{r.capacity ?? "—"}</TableCell>
                <TableCell className="max-w-[200px] truncate">{r.description ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={r.is_active ? "default" : "secondary"}>
                    {r.is_active ? "Aktywny" : "Nieaktywny"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right space-x-2">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(r)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {r.is_active ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteMutation.mutate(r.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => handleRestore(r)}>
                      Przywróć
                    </Button>
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
            <DialogTitle>{editing ? "Edytuj zasób" : "Nowy zasób"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">Nazwa</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="np. Sala konferencyjna A"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Pojemność (opcjonalnie)</label>
              <Input
                type="number"
                value={form.capacity}
                onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                placeholder="np. 10"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Opis (opcjonalnie)</label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="np. Z projektorem, 2 piętro"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Anuluj
            </Button>
            <Button onClick={handleSubmit} disabled={!form.name.trim()}>
              {editing ? "Zapisz" : "Dodaj"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
