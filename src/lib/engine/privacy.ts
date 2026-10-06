// Privacy Mode: mask PAN, Aadhaar, bank account and phone numbers (and email
// local parts) before any text leaves the browser for the LLM.
// Masks keep the same length so line offsets, and therefore citations, still line up.

export interface MaskResult {
  text: string;
  counts: Record<'pan' | 'aadhaar' | 'bank' | 'phone' | 'email', number>;
}

const keepLast = (s: string, n = 4) => s.replace(/[A-Za-z0-9]/g, (c, i) => (i >= s.length - n ? c : 'X'));

export function maskSensitive(input: string): MaskResult {
  const counts: MaskResult['counts'] = { pan: 0, aadhaar: 0, bank: 0, phone: 0, email: 0 };
  let text = input;
  // PAN on its own (the PAN inside a GSTIN stays: GSTINs are public business ids)
  text = text.replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, (m) => (counts.pan++, keepLast(m)));
  // Aadhaar: 12 digits, often grouped 4-4-4
  text = text.replace(/\b\d{4}\s\d{4}\s\d{4}\b|\b(?<!\d)\d{12}(?!\d)\b/g, (m) => (counts.aadhaar++, keepLast(m)));
  // Bank account: 9–18 digits after an account label
  text = text.replace(/(\b(?:a\/c|acct|account)\s*(?:no\.?|number)?\s*[:.-]?\s*)(\d[\d\s-]{7,20}\d)/gi, (_m, label: string, num: string) => (counts.bank++, label + keepLast(num)));
  // Indian phone numbers: optional +91, then 10 digits starting 6-9 (spaces allowed)
  text = text.replace(/(?:\+91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g, (m) => (counts.phone++, keepLast(m)));
  text = text.replace(/\b([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, (_m, user: string, host: string) => (counts.email++, `${'x'.repeat(user.length)}@${host}`));
  return { text, counts };
}

export function totalMasked(c: MaskResult['counts']): number {
  return Object.values(c).reduce((s, n) => s + n, 0);
}
