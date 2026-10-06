// Text helpers shared by the Evidence Lock, the Q&A engine and the diff.

/** Lower-case, unify quotes/dashes/spaces so cosmetic differences never fail a match. */
export function normalize(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/…$/, '')
    .trim();
}

/** Levenshtein distance with an early exit once it exceeds `max`. */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return rowMin;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** 1 = identical, 0 = nothing in common. */
export function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x && !y) return 1;
  const len = Math.max(x.length, y.length);
  return 1 - levenshtein(x, y) / len;
}

export interface WindowMatch {
  score: number;
  start: number; // index into the ORIGINAL haystack
  end: number;
}

/**
 * Find where `needle` best occurs inside `haystack`, tolerating OCR noise.
 * Exact (normalised) containment scores 1. Otherwise a sliding window of the
 * needle's length is compared with Levenshtein similarity.
 */
export function bestWindow(needle: string, haystack: string): WindowMatch {
  const n = normalize(needle);
  if (!n) return { score: 0, start: 0, end: 0 };
  const { norm, map } = normalizeWithMap(haystack);
  const exact = norm.indexOf(n);
  if (exact >= 0) {
    return { score: 1, start: map[exact], end: map[exact + n.length - 1] + 1 };
  }
  if (norm.length < n.length * 0.6) {
    return { score: similarity(needle, haystack) * (norm.length / n.length), start: 0, end: haystack.length };
  }
  let best: WindowMatch = { score: 0, start: 0, end: 0 };
  const win = Math.min(n.length, norm.length);
  const step = Math.max(1, Math.floor(win / 12));
  for (let i = 0; i + win <= norm.length; i += step) {
    const slice = norm.slice(i, i + win);
    const s = 1 - levenshtein(n, slice, Math.ceil(n.length * 0.4)) / Math.max(n.length, slice.length);
    if (s > best.score) best = { score: s, start: map[i], end: map[i + win - 1] + 1 };
    if (s === 1) break;
  }
  return best;
}

/** normalize() plus, for every output character, its index in the input. */
function normalizeWithMap(s: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < s.length; i += 1) {
    let c = s[i].toLowerCase();
    if ('’‘`´'.includes(c)) c = "'";
    else if ('“”'.includes(c)) c = '"';
    else if ('–—−'.includes(c)) c = '-';
    if (/\s/.test(c)) {
      if (lastSpace) continue;
      c = ' ';
      lastSpace = true;
    } else lastSpace = false;
    norm += c;
    map.push(i);
  }
  if (norm.endsWith(' ')) {
    norm = norm.slice(0, -1);
    map.pop();
  }
  return { norm, map };
}

const STOP = new Set('a an and are as at be by for from has have in is it its of on or that the this to was were will with what when which who how does do did is are me my our your there their any'.split(' '));

export function tokens(s: string): string[] {
  return normalize(s)
    .split(/[^\p{L}\p{M}\p{N}\u20b9%.]+/u)
    .map((t) => t.replace(/\.$/, ''))
    .filter((t) => t && !STOP.has(t));
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
