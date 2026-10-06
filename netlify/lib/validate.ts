// Coerce model output into the strict JSON contract. Anything malformed is dropped here;
// whatever survives is still checked against the document text in the browser.

const CATEGORIES = new Set(['deadline', 'amount', 'obligation', 'party', 'date', 'identifier']);

export interface CleanField {
  category: string;
  label: string;
  value: string;
  normalized_value: string | null;
  page: number;
  line: number;
  source_text: string;
  confidence: number;
}

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');
const int = (v: unknown) => {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : typeof v === 'number' ? Math.trunc(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function sanitizeFields(raw: unknown): CleanField[] {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { fields?: unknown })?.fields) ? (raw as { fields: unknown[] }).fields : [];
  const out: CleanField[] = [];
  for (const item of list.slice(0, 80)) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const category = str(o.category, 20).toLowerCase();
    const f: CleanField = {
      category: CATEGORIES.has(category) ? category : 'identifier',
      label: str(o.label, 140),
      value: str(o.value, 400),
      normalized_value: o.normalized_value == null ? null : str(o.normalized_value, 200) || null,
      page: int(o.page),
      line: int(o.line),
      source_text: str(o.source_text, 600),
      confidence: Math.max(0, Math.min(1, Number(o.confidence) || 0.5)),
    };
    if (f.label && f.value && f.page && f.line && f.source_text) out.push(f);
  }
  return out;
}

export function sanitizeChat(raw: unknown): { answer: string; citations: Array<{ page: number; line: number; source_text: string }>; found: boolean } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const answer = str(o.answer, 2000);
  const citations = (Array.isArray(o.citations) ? o.citations : [])
    .slice(0, 6)
    .map((c) => ({ page: int((c as Record<string, unknown>)?.page), line: int((c as Record<string, unknown>)?.line), source_text: str((c as Record<string, unknown>)?.source_text, 600) }))
    .filter((c) => c.page && c.line && c.source_text);
  const found = Boolean(answer) && answer !== 'NOT_FOUND' && citations.length > 0;
  return { answer: found ? answer : 'NOT_FOUND', citations: found ? citations : [], found };
}
