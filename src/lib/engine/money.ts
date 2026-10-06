// Money: find currency amounts and parse Indian / Western digit grouping
// ("4,82,500.00" and "482,500.00" are the same number).

const CURRENCY = String.raw`(?:₹|Rs\.?|INR|\$|USD|€|EUR|£|GBP)`;
const NUMBER = String.raw`\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?`;

export interface FoundAmount {
  value: number;
  text: string;
  index: number;
  end: number;
  currency?: string;
}

export function parseNumber(str: string | null | undefined): number | null {
  if (str == null) return null;
  const cleaned = String(str)
    .replace(/Rs\.?|INR|USD|EUR|GBP/gi, '')
    .replace(/[₹$€£,\s]/g, '')
    .replace(/\/-$/, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function currencyCode(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s === '$' || s === 'USD') return 'USD';
  if (s === '€' || s === 'EUR') return 'EUR';
  if (s === '£' || s === 'GBP') return 'GBP';
  return 'INR';
}

/** Amounts that carry an explicit currency marker. */
export function findCurrencyAmounts(text: string): FoundAmount[] {
  const re = new RegExp(String.raw`(${CURRENCY})\s?(${NUMBER})(?:\s?\/-)?`, 'gi');
  const out: FoundAmount[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = parseNumber(m[2]);
    if (value == null) continue;
    out.push({ value, currency: currencyCode(m[1]), text: m[0], index: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** Every standalone number, ignoring ids such as INV-0423, dates and GSTINs. */
export function findNumbers(text: string): FoundAmount[] {
  const re = new RegExp(String.raw`(?<![\w/\-.])(?:${CURRENCY}\s?)?(${NUMBER})(?![\w/\-]|\.\d)`, 'gi');
  const out: FoundAmount[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = parseNumber(m[1]);
    if (value == null) continue;
    out.push({ value, text: m[0], index: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** The amount a "Total: ..." line is about: the last money-looking number on it. */
export function lastAmount(text: string): FoundAmount | null {
  const withCurrency = findCurrencyAmounts(text);
  if (withCurrency.length) return withCurrency[withCurrency.length - 1];
  const nums = findNumbers(text).filter((n) => !/^\s?%/.test(text.slice(n.end)));
  return nums.length ? nums[nums.length - 1] : null;
}

export function formatINR(value: number | null | undefined, currency = 'INR'): string {
  if (value == null || !Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

/**
 * Equal within ₹1 (rounding / round-off). A percentage tolerance would hide
 * real errors on large invoices (0.1% of ₹4,72,000 is ₹472).
 */
export function moneyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1.000001;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
