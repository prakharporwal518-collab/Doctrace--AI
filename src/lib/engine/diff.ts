// Contract Version Diff: align clauses by number, show word-level changes,
// and summarise the changes that matter ("Payment term changed from 30 to 15 days").

import type { ParsedPage } from '../types';
import { normalize } from './text';

export interface Clause {
  id: string;
  text: string;
  page: number;
  line: number;
}

export interface DiffToken {
  text: string;
  op: 'same' | 'add' | 'del';
}

export interface ClauseChange {
  id: string;
  kind: 'changed' | 'added' | 'removed';
  before: Clause | null;
  after: Clause | null;
  tokens: DiffToken[];
  summary: string[];
}

const CLAUSE_START = /^\s*(\d{1,2}(?:\.\d{1,2}){0,3})[.)]?\s+(?=[A-Za-z(“"])/;

export function splitClauses(pages: ParsedPage[]): Clause[] {
  const out: Clause[] = [];
  let cur: Clause | null = null;
  for (const p of pages) {
    for (const l of p.lines) {
      const m = CLAUSE_START.exec(l.text);
      if (m && Number(m[1].split('.')[0]) < 100) {
        if (cur) out.push(cur);
        cur = { id: m[1], text: l.text.slice(m[0].length).trim(), page: p.number, line: l.line };
      } else if (cur && !/^\s*(?:for\s+|in\s+witness|signature|page\s+\d)/i.test(l.text)) {
        cur.text += ` ${l.text.trim()}`;
      }
    }
  }
  if (cur) out.push(cur);
  // Section headings ("4. FEES AND PAYMENT") carry no terms; keep only real clauses.
  return out.filter((c) => !/^[A-Z\s&,]+$/.test(c.text));
}

/** Word-level LCS diff. */
export function diffWords(a: string, b: string): DiffToken[] {
  const x = a.split(/(\s+)/).filter(Boolean);
  const y = b.split(/(\s+)/).filter(Boolean);
  const n = x.length;
  const m = y.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ text: x[i], op: 'same' });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ text: x[i++], op: 'del' });
    else out.push({ text: y[j++], op: 'add' });
  }
  while (i < n) out.push({ text: x[i++], op: 'del' });
  while (j < m) out.push({ text: y[j++], op: 'add' });
  return out;
}

interface Term {
  value: string;
  unit: string;
}

/** Numbers that carry meaning in a clause: "30 days", "2%", "₹1,50,000". */
function terms(text: string): Term[] {
  const out: Term[] = [];
  for (const m of text.matchAll(/(?:\(\s*)?(\d+(?:\.\d+)?)\s*\)?\s*(days?|months?|years?|weeks?|%|per\s+cent)/gi)) {
    out.push({ value: m[1], unit: m[2].toLowerCase().replace(/s$/, '').replace('per cent', '%') });
  }
  for (const m of text.matchAll(/(?:₹|Rs\.?|INR)\s?([\d,]+(?:\.\d{1,2})?)/g)) out.push({ value: m[1], unit: '₹' });
  return out;
}

function topic(text: string): string {
  const t = text.toLowerCase();
  if (/late\s+fee|interest|penalt/.test(t)) return 'Late fee';
  if (/notice/.test(t)) return 'Notice period';
  if (/uptime|availability/.test(t)) return 'Uptime commitment';
  if (/report/.test(t)) return 'Reporting deadline';
  if (/pay|invoice/.test(t)) return /₹|rs\.?|inr/i.test(text) && !/within/.test(t) ? 'Fee' : 'Payment term';
  if (/renew|term|until|expire/.test(t)) return 'Term';
  if (/liabil/.test(t)) return 'Liability';
  return 'Clause';
}

export function diffContracts(before: ParsedPage[], after: ParsedPage[]): { changes: ClauseChange[]; summary: string[] } {
  const a = splitClauses(before);
  const b = splitClauses(after);
  const byId = new Map(b.map((c) => [c.id, c]));
  const changes: ClauseChange[] = [];
  for (const ca of a) {
    const cb = byId.get(ca.id);
    byId.delete(ca.id);
    if (!cb) {
      changes.push({ id: ca.id, kind: 'removed', before: ca, after: null, tokens: diffWords(ca.text, ''), summary: [`Clause ${ca.id} removed (was p.${ca.page} · L${ca.line})`] });
      continue;
    }
    if (normalize(ca.text) === normalize(cb.text)) continue;
    const ta = terms(ca.text);
    const tb = terms(cb.text);
    const summary: string[] = [];
    for (const unit of new Set([...ta, ...tb].map((t) => t.unit))) {
      const va = ta.filter((t) => t.unit === unit).map((t) => t.value);
      const vb = tb.filter((t) => t.unit === unit).map((t) => t.value);
      for (let k = 0; k < Math.max(va.length, vb.length); k += 1) {
        if (va[k] && vb[k] && va[k] !== vb[k]) {
          const change = unit === '%' ? `${va[k]}% to ${vb[k]}%` : unit === '₹' ? `₹${va[k]} to ₹${vb[k]}` : `${va[k]} to ${vb[k]} ${unit}s`;
          summary.push(`${topic(cb.text)} changed from ${change} (p.${cb.page} · L${cb.line})`);
        }
      }
    }
    if (!summary.length) summary.push(`Clause ${ca.id} reworded (p.${cb.page} · L${cb.line})`);
    changes.push({ id: ca.id, kind: 'changed', before: ca, after: cb, tokens: diffWords(ca.text, cb.text), summary });
  }
  for (const cb of byId.values()) {
    changes.push({ id: cb.id, kind: 'added', before: null, after: cb, tokens: diffWords('', cb.text), summary: [`New clause ${cb.id} added (p.${cb.page} · L${cb.line})`] });
  }
  changes.sort((x, y) => x.id.localeCompare(y.id, undefined, { numeric: true }));
  return { changes, summary: changes.flatMap((c) => c.summary) };
}
