// GET /api/health: tells the app whether an LLM is configured (never the key itself).
import type { Config } from '@netlify/functions';
import { json, llmConfig } from '../lib/llm';

export default async () => {
  const cfg = llmConfig();
  const authRequired = Boolean((process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL) && (process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY));
  return json({ ok: true, ai: Boolean(cfg), provider: cfg?.provider ?? null, model: cfg?.model ?? null, authRequired });
};

export const config: Config = { path: '/api/health' };
