import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useBookings() {
  return useQuery({
    queryKey: ["bookings"],
    queryFn: async () => {
      const { data } = await api.get("/api/bookings");
      return data;
    },
    refetchInterval: 10_000,
  });
}
