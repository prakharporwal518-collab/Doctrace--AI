// Browser side of the AI features. Talks only to our own Netlify Functions
// (/api/*), which hold the API key. Every failure falls back to the
// deterministic engine, so the app never breaks when AI is unavailable.

import { locateQuote } from './engine/evidence';
import { maskSensitive, totalMasked } from './engine/privacy';
import { accessToken } from './supabaseClient';
import type { Citation, FieldCandidate, Lang, ParsedDocument, ParsedPage } from './types';

export interface AiStatus {
  ai: boolean;
  provider: 'gemini' | 'openai' | null;
  model: string | null;
  reason?: string;
}

let statusPromise: Promise<AiStatus> | null = null;

export function aiStatus(force = false): Promise<AiStatus> {
  if (!statusPromise || force) {
    statusPromise = (async () => {
      try {
        const res = await fetchWithTimeout('/api/health', { method: 'GET' }, 4000);
        const type = res.headers.get('content-type') ?? '';
        if (!res.ok || !type.includes('application/json')) return { ai: false, provider: null, model: null, reason: 'Server functions are not running (local dev without `netlify dev`).' };
        const data = (await res.json()) as Partial<AiStatus>;
        return { ai: Boolean(data.ai), provider: data.provider ?? null, model: data.model ?? null, reason: data.ai ? undefined : 'No GEMINI_API_KEY or OPENAI_API_KEY on the server.' };
      } catch {
        return { ai: false, provider: null, model: null, reason: 'Could not reach the server.' };
      }
    })();
  }
  return statusPromise;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Numbered lines exactly as the model sees them; masked in Privacy Mode. */
export function serializeLines(pages: ParsedPage[], privacy: boolean): { text: string; masked: number } {
  let masked = 0;
  const text = pages
    .flatMap((p) => p.lines.map((l) => {
      let t = l.text;
      if (privacy) {
        const m = maskSensitive(t);
        masked += totalMasked(m.counts);
        t = m.text;
      }
      return `p${p.number} L${l.line}: ${t}`;
    }))
    .join('\n');
  return { text, masked };
}

async function post<T>(path: string, body: unknown, ms: number): Promise<T> {
  const token = await accessToken();
  let res: Response;
  try {
    res = await fetchWithTimeout(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }, ms);
  } catch (err) {
    throw new Error((err as Error).name === 'AbortError' ? 'The AI request timed out.' : 'Could not reach the AI service.', { cause: err });
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `AI service error (${res.status}).`);
  return data;
}

export async function aiExtract(parsed: ParsedDocument, opts: { privacy: boolean; docType?: string }): Promise<{ fields: FieldCandidate[]; provider: 'gemini' | 'openai'; masked: number }> {
  const { text, masked } = serializeLines(parsed.pages, opts.privacy);
  const data = await post<{ fields: FieldCandidate[]; provider: 'gemini' | 'openai' }>('/api/extract', { lines: text, docType: opts.docType }, 25000);
  return { fields: data.fields ?? [], provider: data.provider, masked };
}

export interface ChatAnswer {
  answer: string;
  citations: Citation[];
  found: boolean;
  provider: string;
  discarded: number;
}

export async function aiChat(question: string, pages: ParsedPage[], opts: { privacy: boolean; language: Lang; history: Array<{ role: string; content: string }> }): Promise<ChatAnswer> {
  const { text } = serializeLines(pages, opts.privacy);
  const data = await post<{ answer: string; citations: Array<{ page: number; line: number; source_text: string }>; found: boolean; provider: string }>(
    '/api/chat',
    { question, lines: text, language: opts.language, history: opts.history },
    25000,
  );
  // Evidence Lock for chat: keep only citations whose quote really is at that line.
  const parsed: ParsedDocument = { pages, source: 'pdf-text' };
  const verified: Citation[] = [];
  let discarded = 0;
  for (const c of data.citations ?? []) {
    const loc = locateQuote(parsed, c.page, c.line, c.source_text);
    if (loc.score >= 0.86) {
      const line = pages.find((p) => p.number === c.page)?.lines.find((l) => l.line === c.line);
      verified.push({ page: c.page, line: c.line, bbox: loc.bbox, source_text: line?.text.trim() ?? c.source_text });
    } else discarded += 1;
  }
  return { answer: data.answer, citations: verified, found: Boolean(data.found) && verified.length > 0, provider: data.provider, discarded };
}
