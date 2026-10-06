import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Spinner } from '@/components/ui';
import { useAuth } from './auth';

export function FullPageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center" role="status">
      <div className="flex items-center gap-3 text-muted">
        <Spinner /> {label}
      </div>
    </div>
  );
}

/** Protected routes: signed-out visitors go to /login and come back afterwards. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, user, profile } = useAuth();
  const loc = useLocation();
  if (status === 'loading' || (user && !profile)) return <FullPageLoader />;
  if (status === 'signedOut' || !user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}
