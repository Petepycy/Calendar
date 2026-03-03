import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

interface Resource {
  id: number;
  name: string;
}

interface BookingDraft {
  resourceId: number;
  resourceName: string;
  title: string;
  start: string;
  end: string;
  status: "pending";
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (data: BookingDraft) => void;
  isPending: boolean;
}

export default function NewBookingDialog({ open, onOpenChange, onSubmit, isPending }: Props) {
  const [title, setTitle] = useState("");
  const [resourceId, setResourceId] = useState<number | "">("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const { data: resources = [] } = useQuery<Resource[]>({
    queryKey: ["resources"],
    queryFn: async () => {
      const { data } = await api.get<Resource[]>("/api/resources");
      return data;
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const rid = Number(resourceId);
    const resource = resources.find((r) => r.id === rid);
    onSubmit({
      title,
      resourceId: rid,
      resourceName: resource?.name ?? `Zasób ${rid}`,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      status: "pending",
    });
    setTitle("");
    setStart("");
    setEnd("");
    setResourceId("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nowa rezerwacja</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Tytuł</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nazwa spotkania" required />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Sala</label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={resourceId}
              onChange={(e) => setResourceId(Number(e.target.value))}
              required
            >
              <option value="">Wybierz salę...</option>
              {resources.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Od</label>
              <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Do</label>
              <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Anuluj</Button>
            <Button type="submit" disabled={isPending || !resourceId}>
              {isPending ? "Tworzenie..." : "Utwórz rezerwację"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
