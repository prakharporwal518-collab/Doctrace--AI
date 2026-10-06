// Dates for business documents. All arithmetic is in UTC so nothing shifts by
// a day because of the viewer's time zone.

import { smallNumber } from './words';

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_NAMES = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface FoundDate {
  date: Date;
  iso: string;
  text: string;
  index: number;
  end: number;
}

const month = (s: string) => MONTHS[s.toLowerCase().slice(0, 3)];

const PATTERNS: Array<{ re: RegExp; build: (m: RegExpExecArray) => [number, number, number] }> = [
  { re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, build: (m) => [+m[1], +m[2], +m[3]] },
  {
    re: new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+(?:of\s+)?(${MONTH_NAMES})\.?[\s,-]+(\d{4})\b`, 'gi'),
    build: (m) => [+m[3], month(m[2]), +m[1]],
  },
  {
    re: new RegExp(String.raw`\b(${MONTH_NAMES})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b`, 'gi'),
    build: (m) => [+m[3], month(m[1]), +m[2]],
  },
  {
    // Indian DD/MM/YYYY; falls back to MM/DD only when the first part cannot be a month.
    re: /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g,
    build: (m) => {
      const a = +m[1];
      const b = +m[2];
      return b > 12 && a <= 12 ? [+m[3], a, b] : [+m[3], b, a];
    },
  },
];

export function makeDate(y: number, m: number, d: number): Date | null {
  if (!y || !m || !d || m > 12 || d > 31 || y < 1900 || y > 2200) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null; // 31 Feb etc.
  return date;
}

export function toISO(date: Date | null | undefined): string | null {
  if (!date) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function fromISO(iso: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? makeDate(+m[1], +m[2], +m[3]) : null;
}

export function formatDate(d: Date | string | null | undefined): string {
  const date = typeof d === 'string' ? fromISO(d) : d;
  if (!date) return '—';
  return `${date.getUTCDate()} ${SHORT[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function findDates(text: string): FoundDate[] {
  const found: FoundDate[] = [];
  for (const { re, build } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (found.some((f) => start < f.end && end > f.index)) continue;
      const [y, mo, d] = build(m);
      const date = makeDate(y, mo, d);
      if (date) found.push({ date, iso: toISO(date)!, text: m[0], index: start, end });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

export function addMonths(date: Date, months: number): Date {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), last));
  return target;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function todayUTC(now = new Date()): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export interface Duration {
  amount: number;
  unit: 'day' | 'week' | 'month' | 'year';
  text: string;
  index: number;
}

/** "sixty (60) days", "30 days", "thirty days", "two weeks" */
export function findDurations(text: string): Duration[] {
  const re = /\b(?:([a-z]+(?:-[a-z]+)?)\s*)?\(?(\d{1,3})?\)?\s*(?:calendar\s+|business\s+|working\s+)?(day|week|month|year)s?\b/gi;
  const out: Duration[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const digits = m[2] ? Number(m[2]) : null;
    const word = m[1] ? smallNumber(m[1]) : null;
    const amount = digits ?? word;
    if (!amount || amount > 3650) continue;
    const full = m[0].trim();
    const quote = word == null && m[1] ? full.slice(m[1].length).trim() : full;
    out.push({ amount, unit: m[3].toLowerCase() as Duration['unit'], text: quote, index: m.index + (m[0].length - m[0].trimStart().length) });
  }
  return out;
}

export function shiftByDuration(date: Date, d: Pick<Duration, 'amount' | 'unit'>, sign = 1): Date {
  const n = d.amount * sign;
  if (d.unit === 'day') return addDays(date, n);
  if (d.unit === 'week') return addDays(date, n * 7);
  if (d.unit === 'month') return addMonths(date, n);
  return addMonths(date, n * 12);
}

/** Next date that falls on `day` of a month (clamped to month length), on or after `from`. */
export function nextDayOfMonth(day: number, from: Date): Date {
  const y = from.getUTCFullYear();
  const at = (m: number) => {
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(day, last)));
  };
  const thisMonth = at(from.getUTCMonth());
  return thisMonth >= from ? thisMonth : at(from.getUTCMonth() + 1);
}
