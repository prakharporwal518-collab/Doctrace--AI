// Indian tax identifiers: GSTIN (with check digit and state code) and PAN.

export const GST_STATES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};

export const GSTIN_RE = /\b(\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/g;
export const PAN_RE = /\b([A-Z]{5}\d{4}[A-Z])\b/g;
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** GSTIN check digit: mod-36 Luhn variant used by the GST network. */
export function gstinCheckDigit(first14: string): string | null {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const v = CHARS.indexOf(first14[i]);
    if (v < 0) return null;
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export function isValidGSTIN(g: string | null | undefined): boolean {
  if (!g || !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
  return gstinCheckDigit(g.slice(0, 14)) === g[14] && g.slice(0, 2) in GST_STATES;
}

export function gstinState(g: string | null | undefined): { code: string; name: string } | null {
  if (!g) return null;
  const code = g.slice(0, 2);
  return GST_STATES[code] ? { code, name: GST_STATES[code] } : null;
}

/** PAN: 5 letters, 4 digits, 1 letter; the 4th letter is the holder type. */
export function isValidPAN(p: string | null | undefined): boolean {
  return Boolean(p && /^[A-Z]{3}[ABCFGHLJPTK][A-Z]\d{4}[A-Z]$/.test(p));
}

/** State named in a "Place of supply" line, e.g. "Karnataka (29)" or just "29". */
export function stateFromText(text: string): { code: string; name: string } | null {
  const code = /\((\d{2})\)/.exec(text)?.[1] ?? /\b(\d{2})\b/.exec(text)?.[1];
  if (code && GST_STATES[code]) return { code, name: GST_STATES[code] };
  const lower = text.toLowerCase();
  for (const [c, name] of Object.entries(GST_STATES)) {
    if (lower.includes(name.toLowerCase())) return { code: c, name };
  }
  return null;
}
