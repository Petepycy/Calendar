import { api } from "@/lib/api";

export interface KnowledgeEntry {
  id: number;
  category: string;
  question: string;
  answer: string;
}

export async function fetchKnowledge(): Promise<KnowledgeEntry[]> {
  const { data } = await api.get<KnowledgeEntry[]>("/api/knowledge");
  return data;
}

export async function createKnowledgeEntry(data: Omit<KnowledgeEntry, "id">): Promise<KnowledgeEntry> {
  const { data: created } = await api.post<KnowledgeEntry>("/api/knowledge", data);
  return created;
}

export async function updateKnowledgeEntry(id: number, data: Omit<KnowledgeEntry, "id">): Promise<KnowledgeEntry> {
  const { data: updated } = await api.patch<KnowledgeEntry>(`/api/knowledge/${id}`, data);
  return updated;
}

export async function deleteKnowledgeEntry(id: number): Promise<void> {
  await api.delete(`/api/knowledge/${id}`);
}
