// Server-side LLM access for Netlify Functions. The API key lives only in the
// function's environment and never reaches the browser.
//
//   GEMINI_API_KEY (+ optional GEMINI_MODEL)   or   OPENAI_API_KEY (+ optional OPENAI_MODEL)
//   LLM_PROVIDER = gemini | openai  (optional; picks one when both keys exist)

export type Provider = 'gemini' | 'openai';

export interface LlmConfig {
  provider: Provider;
  model: string;
  key: string;
}

const env = (k: string) => (typeof process !== 'undefined' ? process.env[k]?.trim() : undefined) || undefined;

export function llmConfig(): LlmConfig | null {
  const preferred = env('LLM_PROVIDER')?.toLowerCase();
  const gemini = env('GEMINI_API_KEY');
  const openai = env('OPENAI_API_KEY');
  if (gemini && (preferred !== 'openai' || !openai)) return { provider: 'gemini', model: env('GEMINI_MODEL') ?? 'gemini-2.5-flash', key: gemini };
  if (openai) return { provider: 'openai', model: env('OPENAI_MODEL') ?? 'gpt-4o-mini', key: openai };
  return null;
}

export class LlmError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

/** Call the model in JSON mode and return the parsed object. */
export async function callJson(cfg: LlmConfig, system: string, user: string, timeoutMs = 9000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let text: string;
    if (cfg.provider === 'gemini') {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.key },
        signal: ctrl.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        }),
      });
      if (!res.ok) throw new LlmError(`Gemini returned ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status === 429 ? 429 : 502);
      const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    } else {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!res.ok) throw new LlmError(`OpenAI returned ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status === 429 ? 429 : 502);
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      text = data.choices?.[0]?.message?.content ?? '';
    }
    return parseJsonLoose(text);
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new LlmError('The AI model took too long to answer.', 504);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Models occasionally wrap JSON in ``` fences; strip them before parsing. */
export function parseJsonLoose(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new LlmError('The AI model did not return valid JSON.');
  }
}

/* ------------------------------------------------------------------ */
/* Request guards                                                     */
/* ------------------------------------------------------------------ */

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

const hits = new Map<string, number[]>();
/** Best-effort per-IP rate limit (per warm function instance). */
export function rateLimited(ip: string, max = 30, windowMs = 60000): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > max;
}

/**
 * When Supabase is configured, only signed-in users may spend the LLM budget:
 * the browser sends its Supabase access token and we verify it with Supabase.
 */
export async function authorize(req: Request): Promise<{ ok: true } | { ok: false; response: Response }> {
  const url = env('SUPABASE_URL') ?? env('VITE_SUPABASE_URL');
  const anon = env('SUPABASE_ANON_KEY') ?? env('VITE_SUPABASE_ANON_KEY');
  const required = Boolean(url && anon) || env('REQUIRE_AUTH') === 'true';
  if (!required) return { ok: true };
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token || !url || !anon) return { ok: false, response: json({ error: 'Sign in to use AI features.' }, 401) };
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${token}` } });
    if (!res.ok) return { ok: false, response: json({ error: 'Your session has expired. Sign in again.' }, 401) };
    return { ok: true };
  } catch {
    return { ok: false, response: json({ error: 'Could not verify your session.' }, 503) };
  }
}

export function clientIp(req: Request): string {
  return req.headers.get('x-nf-client-connection-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export const MAX_DOC_CHARS = 60000;
