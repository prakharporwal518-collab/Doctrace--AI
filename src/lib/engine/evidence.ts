// Evidence Lock: "No source, no output".
//
// Every field, whether it came from the rules engine or the LLM, must quote
// text that really exists at the page and line it cites. Anything that fails
// is discarded and reported with the reason. This is what stops a model from
// inventing an amount, a date or a clause.

import type { BBox, FieldCandidate, ParsedDocument, ParsedLine, RejectedCandidate } from '../types';
import { findDates } from './dates';
import { findNumbers } from './money';
import { bestWindow, normalize } from './text';

export const MATCH_THRESHOLD = 0.86;

export interface VerifiedField extends FieldCandidate {
  bbox: BBox | null;
  match_score: number;
}

export interface EvidenceResult {
  accepted: VerifiedField[];
  rejected: RejectedCandidate[];
}

/** Rough relative glyph widths, so offsets inside a span follow proportional fonts. */
function charWidth(c: string): number {
  if (c === ' ') return 0.5;
  if (/[il1.,:;'|!()[\]fjtI]/.test(c)) return 0.55;
  if (/[mwMW₹@%]/.test(c)) return 1.45;
  if (/[A-Z]/.test(c)) return 1.2;
  return 1;
}

/** Fraction of a span's width taken by its first `n` characters. */
function widthFraction(text: string, n: number): number {
  let total = 0;
  let upto = 0;
  for (let i = 0; i < text.length; i += 1) {
    const w = charWidth(text[i]);
    total += w;
    if (i < n) upto += w;
  }
  return total ? upto / total : 0;
}

/** Box around characters [start, end) of a line, using glyph spans when we have them. */
export function spanBox(line: ParsedLine, start: number, end: number): BBox | null {
  const b = line.bbox;
  if (!b) return null;
  const spans = line.spans?.length ? line.spans : [{ start: 0, end: line.text.length, x: b.x, w: b.w }];
  const hit = spans.filter((s) => s.end > start && s.start < end);
  if (!hit.length) return { x: b.x, y: b.y, w: b.w, h: b.h };
  const at = (s: (typeof spans)[number], pos: number) => {
    const t = line.text.slice(s.start, s.end);
    return s.x + s.w * widthFraction(t, Math.max(0, Math.min(t.length, pos - s.start)));
  };
  const fx = at(hit[0], start);
  const lx = at(hit[hit.length - 1], end);
  return { x: fx, y: b.y, w: Math.max(0.004, lx - fx), h: b.h };
}

export function unionBox(a: BBox | null, c: BBox | null): BBox | null {
  if (!a) return c;
  if (!c) return a;
  const x = Math.min(a.x, c.x);
  const y = Math.min(a.y, c.y);
  return { x, y, w: Math.max(a.x + a.w, c.x + c.w) - x, h: Math.max(a.y + a.h, c.y + c.h) - y };
}

export function findLine(parsed: ParsedDocument, page: number, line: number): ParsedLine | undefined {
  return parsed.pages.find((p) => p.number === page)?.lines.find((l) => l.line === line);
}

/** Locate a quote at a cited line (or wrapped onto the next line). */
export function locateQuote(parsed: ParsedDocument, page: number, lineNo: number, quote: string): { score: number; bbox: BBox | null } {
  const line = findLine(parsed, page, lineNo);
  if (!line) return { score: 0, bbox: null };
  const one = bestWindow(quote, line.text);
  if (one.score >= MATCH_THRESHOLD) return { score: one.score, bbox: spanBox(line, one.start, one.end) };

  // A sentence may wrap onto the following line.
  const next = findLine(parsed, page, lineNo + 1);
  if (next) {
    const joined = `${line.text} ${next.text}`;
    const two = bestWindow(quote, joined);
    // Only a quote that STARTS on the cited line and runs onto the next counts;
    // a quote sitting wholly on the next line is a wrong citation.
    if (two.score >= MATCH_THRESHOLD && two.start < line.text.length - 1 && two.end > line.text.length) {
      const a = spanBox(line, two.start, line.text.length);
      const b = spanBox(next, 0, Math.max(1, two.end - line.text.length - 1));
      return { score: two.score, bbox: unionBox(a, b) };
    }
    return { score: one.score, bbox: null };
  }
  return { score: one.score, bbox: null };
}

/** The value an LLM reports must be visible in the text it quotes. */
function valueSupported(c: FieldCandidate): boolean {
  if (c.origin === 'rules') return true; // rules read the value out of the quote itself
  const quote = c.source_text;
  if (c.category === 'amount' || c.category === 'line_item') {
    const n = Number(String(c.normalized_value ?? '').replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(n) || !c.normalized_value || c.category === 'line_item') return true;
    if (/%/.test(c.value)) return true;
    return findNumbers(quote).some((x) => Math.abs(x.value - n) <= Math.max(1, Math.abs(n) * 0.001));
  }
  if (c.category === 'identifier') {
    const id = normalize(c.normalized_value || c.value).replace(/[^a-z0-9]/g, '');
    return normalize(quote).replace(/[^a-z0-9]/g, '').includes(id);
  }
  if (c.category === 'date') {
    if (!c.normalized_value) return true;
    return findDates(quote).some((d) => d.iso === c.normalized_value);
  }
  return true;
}

function isWellFormed(c: FieldCandidate): string | null {
  if (!c || typeof c !== 'object') return 'not an object';
  if (!c.label || typeof c.label !== 'string') return 'missing label';
  if (c.value == null || String(c.value).trim() === '') return 'missing value';
  if (!Number.isInteger(c.page) || c.page < 1) return 'missing or invalid page';
  if (!Number.isInteger(c.line) || c.line < 1) return 'missing or invalid line';
  if (!c.source_text || !String(c.source_text).trim()) return 'no source text quoted';
  return null;
}

export function evidenceLock(candidates: FieldCandidate[], parsed: ParsedDocument): EvidenceResult {
  const accepted: VerifiedField[] = [];
  const rejected: RejectedCandidate[] = [];
  const seen = new Set<string>();

  for (const c of candidates) {
    const bad = isWellFormed(c);
    if (bad) {
      rejected.push({ candidate: c, reason: `rejected: ${bad}` });
      continue;
    }
    if (!parsed.pages.some((p) => p.number === c.page)) {
      rejected.push({ candidate: c, reason: `rejected: no evidence (page ${c.page} does not exist)` });
      continue;
    }
    if (!findLine(parsed, c.page, c.line)) {
      rejected.push({ candidate: c, reason: `rejected: no evidence (p.${c.page} has no line ${c.line})` });
      continue;
    }
    const loc = locateQuote(parsed, c.page, c.line, c.source_text);
    if (loc.score < MATCH_THRESHOLD) {
      rejected.push({ candidate: c, reason: `rejected: no evidence (quote not found at p.${c.page} · L${c.line}, best match ${Math.round(loc.score * 100)}%)` });
      continue;
    }
    if (!valueSupported(c)) {
      rejected.push({ candidate: c, reason: `rejected: value "${c.value}" is not in the quoted text` });
      continue;
    }
    const key = `${c.category}|${normalize(c.label)}|${normalize(c.normalized_value ?? c.value)}`;
    if (seen.has(key)) continue; // same fact from two extractors: keep the first
    seen.add(key);
    accepted.push({ ...c, confidence: clamp01(c.confidence), bbox: loc.bbox, match_score: loc.score });
  }
  return { accepted, rejected };
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
}
