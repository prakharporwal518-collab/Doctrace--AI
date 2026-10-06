// A tiny "something changed" signal so every page reloads after uploads,
// reviews or deletes, plus the global upload dialog.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface DataState {
  version: number;
  bump(): void;
  uploadOpen: boolean;
  openUpload(): void;
  closeUpload(): void;
}

const Ctx = createContext<DataState | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const openUpload = useCallback(() => setUploadOpen(true), []);
  const closeUpload = useCallback(() => setUploadOpen(false), []);
  const value = useMemo(() => ({ version, bump, uploadOpen, openUpload, closeUpload }), [version, bump, uploadOpen, openUpload, closeUpload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): DataState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData must be used inside <DataProvider>');
  return v;
}
