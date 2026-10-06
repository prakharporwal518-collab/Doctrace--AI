// POST /api/chat  { question, lines, language: "en"|"hi", history? }
// -> { answer, citations: [{page, line, source_text}], found, provider }
import type { Config } from '@netlify/functions';
import { CHAT_SYSTEM } from '../lib/prompts';
import { authorize, callJson, clientIp, json, LlmError, llmConfig, MAX_DOC_CHARS, rateLimited } from '../lib/llm';
import { sanitizeChat } from '../lib/validate';

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const cfg = llmConfig();
  if (!cfg) return json({ error: 'No LLM API key is configured on the server.' }, 501);
  const auth = await authorize(req);
  if (!auth.ok) return auth.response;
  if (rateLimited(clientIp(req), 40)) return json({ error: 'Too many questions. Wait a minute and try again.' }, 429);

  let body: { question?: unknown; lines?: unknown; language?: unknown; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Request body must be JSON.' }, 400);
  }
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 1000) : '';
  if (!question) return json({ error: 'Ask a question.' }, 400);
  if (typeof body.lines !== 'string') return json({ error: 'Missing "lines".' }, 400);
  const language = body.language === 'hi' ? 'Hindi' : 'English';
  const history = Array.isArray(body.history)
    ? body.history.slice(-6).map((h) => `${(h as { role?: string }).role === 'user' ? 'Q' : 'A'}: ${String((h as { content?: string }).content ?? '').slice(0, 500)}`).join('\n')
    : '';

  try {
    const raw = await callJson(cfg, CHAT_SYSTEM, `Answer in ${language}.\n\nDocument:\n${body.lines.slice(0, MAX_DOC_CHARS)}\n\n${history ? `Earlier conversation:\n${history}\n\n` : ''}Question: ${question}`);
    return json({ ...sanitizeChat(raw), provider: cfg.provider });
  } catch (err) {
    const status = err instanceof LlmError ? err.status : 500;
    return json({ error: (err as Error).message || 'AI chat failed.' }, status);
  }
};

export const config: Config = { path: '/api/chat' };
