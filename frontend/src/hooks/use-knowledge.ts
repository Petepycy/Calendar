import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchKnowledge,
  createKnowledgeEntry,
  updateKnowledgeEntry,
  deleteKnowledgeEntry,
  type KnowledgeEntry,
} from "@/lib/knowledge";

export function useKnowledge() {
  return useQuery({ queryKey: ["knowledge"], queryFn: fetchKnowledge });
}

export function useCreateKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<KnowledgeEntry, "id">) => createKnowledgeEntry(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge"] }),
  });
}

export function useUpdateKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Omit<KnowledgeEntry, "id"> }) =>
      updateKnowledgeEntry(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge"] }),
  });
}

export function useDeleteKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteKnowledgeEntry(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge"] }),
  });
}
