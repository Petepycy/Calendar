import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const { refetch } = useAuth();

  useEffect(() => {
    refetch().then(() => {
      navigate("/app", { replace: true });
    });
  }, [navigate, refetch]);

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}
