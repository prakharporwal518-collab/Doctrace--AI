// Authentication + the data repository for the signed-in user.
// Cloud mode: Supabase Auth (email/password, Google). Offline mode: local
// accounts in IndexedDB. Both expose the same API to the rest of the app.

import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CLOUD, DEMO_EMAIL, DEMO_PASSWORD } from '@/lib/config';
import { LocalRepo } from '@/lib/data/local';
import type { Repo } from '@/lib/data/repo';
import { SupabaseRepo } from '@/lib/data/supabase';
import { currentLocalSession, localSignIn, localSignOut, localSignUp } from '@/lib/localAuth';
import { seedDemoData } from '@/lib/services/seed';
import { supabase } from '@/lib/supabaseClient';
import type { Profile } from '@/lib/types';

interface User {
  id: string;
  email: string;
}

interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  user: User | null;
  profile: Profile | null;
  repo: Repo | null;
  mode: 'cloud' | 'local';
  isDemo: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, meta: { full_name: string; organisation: string }): Promise<{ needsConfirmation: boolean }>;
  signInWithGoogle(): Promise<void>;
  signInDemo(onProgress?: (msg: string) => void): Promise<void>;
  signOut(): Promise<void>;
  updateProfile(patch: Partial<Profile>): Promise<void>;
  resetDemo(onProgress?: (msg: string) => void): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

function friendly(err: unknown): Error {
  const msg = (err as { message?: string })?.message ?? String(err);
  if (/invalid login credentials/i.test(msg)) return new Error('Wrong email or password.');
  if (/email not confirmed/i.test(msg)) return new Error('Confirm your email first: check your inbox for the link.');
  if (/user already registered/i.test(msg)) return new Error('An account with this email already exists. Sign in instead.');
  if (/failed to fetch|network/i.test(msg)) return new Error('Could not reach the server. Check your connection.');
  return err instanceof Error ? err : new Error(msg);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Offline mode knows its session synchronously; cloud mode asks Supabase below.
  const [initialLocal] = useState(() => (CLOUD ? null : currentLocalSession()));
  const [status, setStatus] = useState<AuthState['status']>(CLOUD || initialLocal ? 'loading' : 'signedOut');
  const [user, setUser] = useState<User | null>(initialLocal ? { id: initialLocal.userId, email: initialLocal.email } : null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const repo = useMemo<Repo | null>(() => {
    if (!user) return null;
    return CLOUD ? new SupabaseRepo(supabase()!, user.id) : new LocalRepo(user.id);
  }, [user]);

  // Load the profile whenever the user changes.
  useEffect(() => {
    if (!repo) return;
    let cancelled = false;
    repo.getProfile().then(
      (p) => {
        if (cancelled) return;
        setProfile(p);
        setStatus('signedIn');
      },
      (err) => {
        // Keep the app usable with defaults; pages surface their own data errors.
        console.error('Could not load profile', err);
        if (cancelled) return;
        setProfile({ id: repo.userId, full_name: null, organisation: null, role: 'uploader', language: 'en', avatar_url: null, privacy_mode: false, created_at: new Date().toISOString() });
        setStatus('signedIn');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [repo]);

  // Restore the session on load.
  useEffect(() => {
    if (CLOUD) {
      const client = supabase()!;
      const apply = (s: Session | null) => {
        if (s?.user) setUser((u) => (u?.id === s.user.id ? u : { id: s.user.id, email: s.user.email ?? '' }));
        else {
          setUser(null);
          setProfile(null);
          setStatus('signedOut');
        }
      };
      client.auth.getSession().then(({ data }) => apply(data.session), () => setStatus('signedOut'));
      const { data } = client.auth.onAuthStateChange((_e, s) => apply(s));
      return () => data.subscription.unsubscribe();
    }
    return undefined;
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      if (CLOUD) {
        const { data, error } = await supabase()!.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        setUser({ id: data.user.id, email: data.user.email ?? email });
      } else {
        const s = await localSignIn(email, password);
        setUser({ id: s.userId, email: s.email });
      }
    } catch (err) {
      throw friendly(err);
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string, meta: { full_name: string; organisation: string }) => {
    try {
      if (CLOUD) {
        const { data, error } = await supabase()!.auth.signUp({ email: email.trim(), password, options: { data: { full_name: meta.full_name }, emailRedirectTo: `${window.location.origin}/dashboard` } });
        if (error) throw error;
        if (!data.session) return { needsConfirmation: true };
        const r = new SupabaseRepo(supabase()!, data.user!.id);
        await r.updateProfile({ full_name: meta.full_name, organisation: meta.organisation || null });
        setUser({ id: data.user!.id, email: data.user!.email ?? email });
        return { needsConfirmation: false };
      }
      const s = await localSignUp(email, password);
      await new LocalRepo(s.userId).updateProfile({ full_name: meta.full_name, organisation: meta.organisation || null });
      setUser({ id: s.userId, email: s.email });
      return { needsConfirmation: false };
    } catch (err) {
      throw friendly(err);
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!CLOUD) throw new Error('Google sign-in needs Supabase. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see README).');
    const { error } = await supabase()!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/dashboard` } });
    if (error) throw friendly(error);
  }, []);

  const signInDemo = useCallback(async (onProgress?: (msg: string) => void) => {
    let r: Repo;
    try {
      if (CLOUD) {
        const client = supabase()!;
        let userId: string;
        const first = await client.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
        if (!first.error) userId = first.data.user.id;
        else if (/invalid login credentials/i.test(first.error.message)) {
          // First run: create the demo user (works when email confirmation is off).
          const up = await client.auth.signUp({ email: DEMO_EMAIL, password: DEMO_PASSWORD, options: { data: { full_name: 'Aarav Mehta' } } });
          if (up.error) throw up.error;
          if (!up.data.session || !up.data.user) throw new Error('The demo account is not set up yet. Run `npm run seed` once (see README).');
          userId = up.data.user.id;
        } else throw first.error;
        r = new SupabaseRepo(client, userId);
      } else {
        let s;
        try {
          s = await localSignIn(DEMO_EMAIL, DEMO_PASSWORD);
        } catch {
          s = await localSignUp(DEMO_EMAIL, DEMO_PASSWORD);
        }
        r = new LocalRepo(s.userId);
      }
      // Seed on first use so judges always see a complete demo.
      if (!(await r.listDocuments()).length) await seedDemoData(r, onProgress);
      setUser({ id: r.userId, email: DEMO_EMAIL });
    } catch (err) {
      throw friendly(err);
    }
  }, []);

  const signOut = useCallback(async () => {
    if (CLOUD) await supabase()!.auth.signOut();
    else localSignOut();
    setUser(null);
    setProfile(null);
    setStatus('signedOut');
  }, []);

  const updateProfile = useCallback(
    async (patch: Partial<Profile>) => {
      if (!repo) return;
      setProfile(await repo.updateProfile(patch));
    },
    [repo],
  );

  const resetDemo = useCallback(
    async (onProgress?: (msg: string) => void) => {
      if (!repo) return;
      await seedDemoData(repo, onProgress);
      setProfile(await repo.getProfile());
    },
    [repo],
  );

  const value = useMemo<AuthState>(
    () => ({ status, user, profile, repo, mode: CLOUD ? 'cloud' : 'local', isDemo: user?.email === DEMO_EMAIL, signIn, signUp, signInWithGoogle, signInDemo, signOut, updateProfile, resetDemo }),
    [status, user, profile, repo, signIn, signUp, signInWithGoogle, signInDemo, signOut, updateProfile, resetDemo],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

/** For pages behind <RequireAuth>: the repo and profile are guaranteed. */
export function useSession(): AuthState & { repo: Repo; profile: Profile; user: User } {
  const a = useAuth();
  if (!a.repo || !a.profile || !a.user) throw new Error('No session');
  return a as AuthState & { repo: Repo; profile: Profile; user: User };
}
