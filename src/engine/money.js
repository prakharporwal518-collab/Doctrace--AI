// Money helpers: find currency amounts in a line and parse Indian / Western
// digit grouping ("4,82,500.00" and "482,500.00" are the same number).

const CURRENCY = String.raw`(?:₹|Rs\.?|INR|\$|USD|€|EUR|£|GBP)`;
const NUMBER = String.raw`\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?`;

const CURRENCY_AMOUNT = new RegExp(
  String.raw`(${CURRENCY})\s?(${NUMBER})(?:\s?\/-)?`,
  'gi',
);

export function parseNumber(str) {
  if (str == null) return null;
  const cleaned = String(str).replace(/[₹$€£,\s]|Rs\.?|INR|USD|EUR|GBP/gi, '').replace(/\/-$/, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function currencyCode(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (s === '₹' || s.startsWith('RS') || s === 'INR') return 'INR';
  if (s === '$' || s === 'USD') return 'USD';
  if (s === '€' || s === 'EUR') return 'EUR';
  if (s === '£' || s === 'GBP') return 'GBP';
  return 'INR';
}

/** All amounts that carry an explicit currency marker. */
export function findCurrencyAmounts(text) {
  const out = [];
  CURRENCY_AMOUNT.lastIndex = 0;
  let m;
  while ((m = CURRENCY_AMOUNT.exec(text)) !== null) {
    const value = parseNumber(m[2]);
    if (value == null) continue;
    out.push({ value, currency: currencyCode(m[1]), text: m[0], index: m.index });
  }
  return out;
}

// A standalone numeric token: not glued to letters, slashes or hyphens (so
// "INV-0423", "15/10/2026" and GSTINs are not mistaken for amounts).
const NUMERIC_TOKEN = new RegExp(
  String.raw`(?<![\w\/\-.])(?:${CURRENCY}\s?)?(${NUMBER})(?![\w\/\-]|\.\d)`,
  'gi',
);

/** Every standalone number in the line, with or without a currency marker. */
export function findNumbers(text) {
  const out = [];
  NUMERIC_TOKEN.lastIndex = 0;
  let m;
  while ((m = NUMERIC_TOKEN.exec(text)) !== null) {
    const value = parseNumber(m[1]);
    if (value == null) continue;
    out.push({ value, text: m[0], index: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** The amount a "Total: ..." style line is about: the last number on it. */
export function lastAmount(text) {
  const withCurrency = findCurrencyAmounts(text);
  if (withCurrency.length) return withCurrency[withCurrency.length - 1];
  const nums = findNumbers(text).filter((n) => !isPercentAt(text, n.end));
  return nums.length ? nums[nums.length - 1] : null;
}

function isPercentAt(text, end) {
  return /^\s?%/.test(text.slice(end));
}

export function formatMoney(value, currency = 'INR') {
  if (value == null || !Number.isFinite(value)) return '—';
  try {
    const locale = currency === 'INR' ? 'en-IN' : 'en-US';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

/** Tolerance for comparing money: one rupee or 0.1 %, whichever is bigger. */
export function moneyEqual(a, b) {
  const tol = Math.max(1, Math.abs(b) * 0.001);
  return Math.abs(a - b) <= tol;
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}
