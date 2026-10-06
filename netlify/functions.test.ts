// Netlify Functions, tested by calling the handlers directly with a mocked fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import chat from './functions/chat.mts';
import extract from './functions/extract.mts';
import health from './functions/health.mts';
import { parseJsonLoose } from './lib/llm';
import { sanitizeChat, sanitizeFields } from './lib/validate';

const KEYS = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'LLM_PROVIDER', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'REQUIRE_AUTH'];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://x.test/api/extract', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': `10.0.0.${Math.floor(Math.random() * 250)}`, ...headers }, body: JSON.stringify(body) });

/** A Gemini generateContent response wrapping `obj` as JSON text. */
const gemini = (obj: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(obj) + '\n```' }] } }] }), { status: 200 });

describe('/api/health', () => {
  it('reports no AI without keys and never leaks a key', async () => {
    const res = await health();
    expect(await res.json()).toMatchObject({ ok: true, ai: false, provider: null });
    process.env.GEMINI_API_KEY = 'secret-key-123';
    const text = await (await health()).text();
    expect(JSON.parse(text)).toMatchObject({ ai: true, provider: 'gemini' });
    expect(text).not.toContain('secret-key-123');
  });
});

describe('/api/extract', () => {
  it('returns 501 when no LLM key is configured (client falls back to rules)', async () => {
    expect((await extract(post({ lines: 'p1 L1: x' }))).status).toBe(501);
  });

  it('rejects bad input', async () => {
    process.env.GEMINI_API_KEY = 'k';
    expect((await extract(new Request('https://x.test', { method: 'GET' }))).status).toBe(405);
    expect((await extract(post({}))).status).toBe(400);
    const bad = new Request('https://x.test', { method: 'POST', body: 'not json' });
    expect((await extract(bad)).status).toBe(400);
  });

  it('calls Gemini server-side and returns strictly shaped fields', async () => {
    process.env.GEMINI_API_KEY = 'k';
    const fetchMock = vi.fn(async () =>
      gemini({
        fields: [
          { category: 'amount', label: 'Total', value: '₹4,82,500.00', normalized_value: '482500.00', page: 2, line: 18, source_text: 'Total amount payable ₹4,82,500.00', confidence: 0.97 },
          { category: 'amount', label: 'Broken', value: '1', page: 0, line: 1, source_text: 'x' }, // invalid page -> dropped
          { label: 'No quote', value: 'x', page: 1, line: 1 }, // no source_text -> dropped
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await extract(post({ lines: 'p2 L18: Total amount payable ₹4,82,500.00' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.provider).toBe('gemini');
    expect(data.fields).toEqual([{ category: 'amount', label: 'Total', value: '₹4,82,500.00', normalized_value: '482500.00', page: 2, line: 18, source_text: 'Total amount payable ₹4,82,500.00', confidence: 0.97 }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('generativelanguage.googleapis.com');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
  });

  it('turns provider errors into a clean error response', async () => {
    process.env.OPENAI_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('quota exceeded', { status: 429 })));
    const res = await extract(post({ lines: 'p1 L1: x' }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/OpenAI returned 429/);
  });

  it('requires a valid Supabase session when Supabase is configured', async () => {
    process.env.GEMINI_API_KEY = 'k';
    process.env.VITE_SUPABASE_URL = 'https://proj.supabase.co';
    process.env.VITE_SUPABASE_ANON_KEY = 'anon';
    expect((await extract(post({ lines: 'p1 L1: x' }))).status).toBe(401);
    const fetchMock = vi.fn(async (url: string) => (url.includes('/auth/v1/user') ? new Response('{}', { status: 401 }) : gemini({ fields: [] })));
    vi.stubGlobal('fetch', fetchMock);
    expect((await extract(post({ lines: 'p1 L1: x' }, { authorization: 'Bearer expired' }))).status).toBe(401);
    fetchMock.mockImplementation(async (url: string) => (url.includes('/auth/v1/user') ? new Response('{"id":"u"}', { status: 200 }) : gemini({ fields: [] })));
    expect((await extract(post({ lines: 'p1 L1: x' }, { authorization: 'Bearer good' }))).status).toBe(200);
  });
});

describe('/api/chat', () => {
  it('normalises "not in the document" answers', async () => {
    process.env.GEMINI_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async () => gemini({ answer: 'Probably Mumbai', citations: [] })));
    const res = await chat(post({ question: 'Where is the head office?', lines: 'p1 L1: x', language: 'en' }));
    expect(await res.json()).toMatchObject({ answer: 'NOT_FOUND', citations: [], found: false });
  });
});

describe('validation helpers', () => {
  it('parses fenced or chatty JSON', () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('Here you go: {"a":2} hope that helps')).toEqual({ a: 2 });
    expect(() => parseJsonLoose('no json here')).toThrow();
  });
  it('coerces types and clamps confidence', () => {
    expect(sanitizeFields([{ category: 'weird', label: 'L', value: 5, page: '2', line: 3.7, source_text: 's', confidence: 7 }])[0]).toEqual({ category: 'identifier', label: 'L', value: '5', normalized_value: null, page: 2, line: 3, source_text: 's', confidence: 1 });
    expect(sanitizeChat({ answer: 'Yes', citations: [{ page: 1, line: 2, source_text: 'q' }] })).toMatchObject({ found: true });
  });
});
