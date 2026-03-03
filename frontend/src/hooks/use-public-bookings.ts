import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function usePublicBookings(tenantSlug: string | null) {
  return useQuery({
    queryKey: ["bookings-public", tenantSlug],
    queryFn: async () => {
      const { data } = await api.get("/api/bookings/public", {
        params: { tenant_slug: tenantSlug },
      });
      return data as { id: number; start: string; end: string }[];
    },
    enabled: !!tenantSlug,
    refetchInterval: 30_000,
  });
}
