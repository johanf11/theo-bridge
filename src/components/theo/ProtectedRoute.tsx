import { Navigate } from "react-router-dom";
import { useAuth, useRoles } from "@/lib/auth";

export function ProtectedRoute({ children, adminOnly }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user, loading } = useAuth();
  const { isAdmin, roles } = useRoles();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && roles.length > 0 && !isAdmin) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
