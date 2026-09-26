// Date parsing for business documents. Everything is done in UTC so that a
// date never shifts by a day because of the viewer's time zone.

import { smallNumber } from './words.js';

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_NAMES = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const PATTERNS = [
  // 2026-10-15
  { re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, build: (m) => [m[1], m[2], m[3]] },
  // 15 Oct 2026, 15th October, 2026, 1-Apr-2027
  {
    re: new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?[\s\-]+(?:of\s+)?(${MONTH_NAMES})\.?[\s\-,]+(\d{4})\b`, 'gi'),
    build: (m) => [m[3], MONTHS[m[2].toLowerCase().slice(0, 3)] ?? MONTHS[m[2].toLowerCase()], m[1]],
  },
  // October 15, 2026
  {
    re: new RegExp(String.raw`\b(${MONTH_NAMES})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b`, 'gi'),
    build: (m) => [m[3], MONTHS[m[1].toLowerCase().slice(0, 3)], m[2]],
  },
  // 15/10/2026, 15.10.2026, 15-10-2026 (Indian DD/MM/YYYY, falls back to MM/DD when unambiguous)
  {
    re: /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g,
    build: (m) => {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (b > 12 && a <= 12) return [m[3], a, b];
      return [m[3], b, a];
    },
  },
];

export function makeDate(y, m, d) {
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!year || !month || !day || month > 12 || day > 31 || year < 1900 || year > 2200) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects 31 Feb and friends: Date.UTC would silently roll them over.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

export function toISO(date) {
  if (!date) return null;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDate(date) {
  if (!date) return '—';
  return `${date.getUTCDate()} ${SHORT[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function fromISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? makeDate(m[1], m[2], m[3]) : null;
}

/** Every date in the text, in reading order, without overlaps. */
export function findDates(text) {
  const found = [];
  for (const { re, build } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (found.some((f) => start < f.end && end > f.index)) continue;
      const [y, mo, d] = build(m);
      const date = makeDate(y, mo, d);
      if (date) found.push({ date, iso: toISO(date), text: m[0], index: start, end });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

export function addMonths(date, months) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const d = date.getUTCDate();
  const target = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target;
}

export function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function todayUTC(now = new Date()) {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

const DURATION = /\b(?:([a-z]+(?:-[a-z]+)?)\s*)?\(?(\d{1,3})?\)?\s*(calendar\s+|business\s+|working\s+)?(day|week|month|year)s?\b/gi;

/**
 * Durations such as "sixty (60) days", "30 days", "thirty days", "two weeks".
 * Returns [{ amount, unit, text, index }].
 */
export function findDurations(text) {
  const out = [];
  DURATION.lastIndex = 0;
  let m;
  while ((m = DURATION.exec(text)) !== null) {
    const digits = m[2] ? Number(m[2]) : null;
    const word = m[1] ? smallNumber(m[1]) : null;
    const amount = digits ?? word;
    if (!amount || amount > 3650) continue;
    // "one-year terms" style phrases are durations too, keep them.
    const matchedText = digits == null && word == null ? null : m[0].trim();
    if (!matchedText) continue;
    // If the leading word is not a number word, drop it from the quote.
    const text2 = word == null && m[1] ? matchedText.slice(m[1].length).trim() : matchedText;
    out.push({ amount, unit: m[4].toLowerCase(), text: text2, index: m.index + (m[0].length - m[0].trimStart().length) });
  }
  return out;
}

export function shiftByDuration(date, { amount, unit }, sign = 1) {
  const n = amount * sign;
  if (unit === 'day') return addDays(date, n);
  if (unit === 'week') return addDays(date, n * 7);
  if (unit === 'month') return addMonths(date, n);
  if (unit === 'year') return addMonths(date, n * 12);
  return date;
}
