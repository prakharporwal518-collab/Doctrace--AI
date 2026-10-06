import { StrictMode, lazy, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './app/AppShell';
import { AuthProvider } from './app/auth';
import { DataProvider } from './app/data';
import { ErrorBoundary } from './app/ErrorBoundary';
import { FullPageLoader, RequireAuth } from './app/RequireAuth';
import { ToastProvider } from './app/toast';
import './index.css';

const Landing = lazy(() => import('./pages/Landing'));
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Documents = lazy(() => import('./pages/Documents'));
const DocumentDetail = lazy(() => import('./pages/DocumentDetail'));
const ThreeWay = lazy(() => import('./pages/ThreeWay'));
const Radar = lazy(() => import('./pages/Radar'));
const Compare = lazy(() => import('./pages/Compare'));
const Vendors = lazy(() => import('./pages/Vendors'));
const Audit = lazy(() => import('./pages/Audit'));
const Settings = lazy(() => import('./pages/Settings'));
const NotFound = lazy(() => import('./pages/NotFound'));

/** Signed-in pages: auth guard + sidebar layout + per-page error boundary. */
function Private({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <DataProvider>
        <AppShell>
          <ErrorBoundary>
            <Suspense fallback={<FullPageLoader />}>{children}</Suspense>
          </ErrorBoundary>
        </AppShell>
      </DataProvider>
    </RequireAuth>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary fullPage>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Suspense fallback={<FullPageLoader />}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Login />} />
                <Route path="/dashboard" element={<Private><Dashboard /></Private>} />
                <Route path="/documents" element={<Private><Documents /></Private>} />
                <Route path="/documents/:id" element={<Private><DocumentDetail /></Private>} />
                <Route path="/three-way" element={<Private><ThreeWay /></Private>} />
                <Route path="/radar" element={<Private><Radar /></Private>} />
                <Route path="/compare" element={<Private><Compare /></Private>} />
                <Route path="/vendors" element={<Private><Vendors /></Private>} />
                <Route path="/audit" element={<Private><Audit /></Private>} />
                <Route path="/settings" element={<Private><Settings /></Private>} />
                <Route path="/app" element={<Navigate to="/dashboard" replace />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
