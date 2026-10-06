// Runtime configuration. With VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY set,
// the app uses Supabase (auth, Postgres with RLS, storage). Without them it runs
// in offline demo mode: same features, data kept in this browser's IndexedDB.

// import.meta.env exists under Vite; the Node seed script passes its own client instead.
const env = ((import.meta as { env?: Record<string, string | undefined> }).env ?? {}) as Record<string, string | undefined>;
const url = env.VITE_SUPABASE_URL?.trim();
const anon = env.VITE_SUPABASE_ANON_KEY?.trim();

export const SUPABASE_URL = url || '';
export const SUPABASE_ANON_KEY = anon || '';
export const CLOUD = Boolean(url && anon && /^https?:\/\//.test(url));

export const DEMO_EMAIL = 'demo@doctrace.ai';
export const DEMO_PASSWORD = 'Demo@1234';
export const STORAGE_BUCKET = 'documents';
