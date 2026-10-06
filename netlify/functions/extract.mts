// POST /api/extract  { lines: string, docType?: string }
// -> { fields: FieldCandidate[], provider }  (strict JSON, validated here, verified again in the browser)
import type { Config } from '@netlify/functions';
import { EXTRACT_SYSTEM } from '../lib/prompts';
import { authorize, callJson, clientIp, json, LlmError, llmConfig, MAX_DOC_CHARS, rateLimited } from '../lib/llm';
import { sanitizeFields } from '../lib/validate';

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const cfg = llmConfig();
  if (!cfg) return json({ error: 'No LLM API key is configured on the server.' }, 501);
  const auth = await authorize(req);
  if (!auth.ok) return auth.response;
  if (rateLimited(clientIp(req), 20)) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429);

  let body: { lines?: unknown; docType?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Request body must be JSON.' }, 400);
  }
  if (typeof body.lines !== 'string' || !body.lines.trim()) return json({ error: 'Missing "lines".' }, 400);
  const lines = body.lines.slice(0, MAX_DOC_CHARS);
  const hint = typeof body.docType === 'string' ? `\nThe document looks like: ${body.docType.slice(0, 40)}.` : '';

  try {
    const raw = await callJson(cfg, EXTRACT_SYSTEM, `Document:${hint}\n\n${lines}`);
    return json({ fields: sanitizeFields(raw), provider: cfg.provider, model: cfg.model, truncated: body.lines.length > MAX_DOC_CHARS });
  } catch (err) {
    const status = err instanceof LlmError ? err.status : 500;
    return json({ error: (err as Error).message || 'AI extraction failed.' }, status);
  }
};

export const config: Config = { path: '/api/extract' };
