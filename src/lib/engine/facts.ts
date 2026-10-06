// Deterministic fact extraction. Every fact remembers the line it came from,
// so the anomaly engine and the field extractor can always cite their source.

import type { DocType, ParsedDocument, ParsedLine } from '../types';
import { findDates, findDurations, type Duration } from './dates';
import { GSTIN_RE, PAN_RE, stateFromText } from './ids';
import { findCurrencyAmounts, findNumbers, lastAmount, parseNumber } from './money';
import { extractWordsPhrase, parseAmountInWords } from './words';

export interface Hit<T = string> {
  value: T;
  line: ParsedLine;
  quote: string;
}

export interface LineItem {
  line: ParsedLine;
  description: string;
  qty: number;
  rate: number;
  amount: number;
  qtyText: string;
  rateText: string;
  amountText: string;
}

export interface Tax {
  kind: string;
  rate: number;
  value: number;
  line: ParsedLine;
  quote: string;
  rateQuote: string;
}

export interface LateFee {
  kind: 'percent_month' | 'percent_year' | 'per_day';
  rate: number;
  partThereof: boolean;
}

export interface Facts {
  docType: DocType;
  typeConfidence: number;
  lines: ParsedLine[];
  currency: string;
  // identifiers
  invoiceNumber?: Hit;
  poNumber?: Hit; // this document's own PO number
  poReference?: Hit; // a PO referenced by an invoice / delivery note
  dnNumber?: Hit;
  agreementNumber?: Hit;
  gstins: Hit[];
  supplierGSTIN?: Hit;
  buyerGSTIN?: Hit;
  pans: Hit[];
  // parties
  supplier?: Hit;
  buyer?: Hit;
  signingEntity?: Hit;
  parties: Hit[];
  // dates
  invoiceDate?: Hit<Date>;
  dueDate?: Hit<Date>;
  poDate?: Hit<Date>;
  deliveryDate?: Hit<Date>;
  dnDate?: Hit<Date>;
  effectiveDate?: Hit<Date>;
  renewalDate?: Hit<Date>;
  endDate?: Hit<Date>;
  // GST
  placeOfSupply?: Hit<{ code: string; name: string }>;
  hsn?: Hit;
  // money
  items: LineItem[];
  subtotal?: Hit<number>;
  taxes: Tax[];
  adjustments: Hit<number>[];
  total?: Hit<number>;
  amountInWords?: Hit<number>;
  // clauses
  lateFee?: Hit<LateFee>;
  paymentTerms?: Hit<Duration>;
  noticeClause?: Hit<Duration>;
  autoRenewal?: Hit;
  termination?: Hit;
  governingLaw?: Hit;
  signature?: Hit<boolean>;
  receivedBy?: Hit;
  deliveryAddress?: Hit;
}

/* ------------------------------------------------------------------ */
/* Classification                                                     */
/* ------------------------------------------------------------------ */

const TITLE: Array<[DocType, RegExp]> = [
  ['purchase_order', /\bpurchase\s+order\b/i],
  ['delivery_note', /\b(?:delivery\s+(?:note|challan)|goods\s+received\s+note|dispatch\s+note)\b/i],
  ['invoice', /\b(?:tax\s+)?invoice\b|\bbill\s+of\s+supply\b/i],
  ['contract', /\b(?:agreement|contract|memorandum\s+of\s+understanding|terms\s+of\s+service)\b/i],
];

const KEYWORDS: Record<Exclude<DocType, 'other'>, RegExp[]> = {
  invoice: [/\binvoice\s*(?:no|number|date)/i, /\bgstin\b/i, /\bbill\s+to\b|\bbuyer\b/i, /\bsub\s*-?total\b/i, /\b[cs]gst\b|\bigst\b/i, /\bamount\s+in\s+words\b/i, /\bpay\s+by\b|\bdue\s+date\b/i],
  contract: [/\bshall\b/i, /\bpart(?:y|ies)\b/i, /\bterminat/i, /\bgoverning\s+law\b|\bjurisdiction\b/i, /\bhereinafter\b|\bwhereas\b/i, /\bindemnif/i, /\bconfidential/i],
  purchase_order: [/\bpo\s*(?:no|number|date)/i, /\bdeliver(?:y)?\s+(?:to|by)\b/i, /\bvendor\b/i, /\bordered\b|\border\s+date\b/i],
  delivery_note: [/\bdelivery\s+note\b|\bchallan\b/i, /\breceived\s+by\b/i, /\bdispatched\b|\bdelivered\b/i, /\bqty\s+delivered\b|\bquantity\s+received\b/i],
};

export function classify(lines: ParsedLine[]): { type: DocType; confidence: number } {
  // The title is the strongest signal: the earliest of the first lines that names a
  // document type wins ("MASTER SERVICES AGREEMENT" beats a later "purchase order").
  for (const line of lines.slice(0, 3)) {
    for (const [type, re] of TITLE) {
      if (re.test(line.text) && line.text.length < 80) return { type, confidence: 0.97 };
    }
  }
  const text = lines.map((l) => l.text).join('\n');
  const scores = Object.entries(KEYWORDS).map(([t, res]) => [t, res.filter((r) => r.test(text)).length] as const);
  scores.sort((a, b) => b[1] - a[1]);
  if (!scores[0][1]) return { type: 'other', confidence: 0.4 };
  const margin = scores[0][1] - scores[1][1];
  return { type: scores[0][0] as DocType, confidence: Math.min(0.95, 0.55 + margin * 0.08 + scores[0][1] * 0.04) };
}

/* ------------------------------------------------------------------ */
/* Label patterns                                                     */
/* ------------------------------------------------------------------ */

const ID = String.raw`([A-Z0-9][A-Z0-9\-/]{2,})`;
const RE = {
  invoiceNumber: new RegExp(String.raw`\b(?:invoice|bill|inv)\s*(?:no\b\.?|number|num\b|#)\s*[:#-]?\s*${ID}`, 'i'),
  poNumber: new RegExp(String.raw`(?:\bp\.\s?o\.|\bpo\b|\bpurchase\s+order\b)\s*(?:(?:no\b\.?|number|ref(?:erence)?\b\.?|#)\s*[:#-]?|[:#-])\s*${ID}`, 'i'),
  dnNumber: new RegExp(String.raw`\b(?:delivery\s+note|challan|dn)\s*(?:no\b\.?|number|#)?\s*[:#-]\s*${ID}|\bdelivery\s+note\s*(?:no\b\.?|number)\s*[:#-]?\s*${ID}`, 'i'),
  agreementNumber: new RegExp(String.raw`\b(?:agreement|contract)\s*(?:no\b\.?|number|ref)\s*[:#-]?\s*${ID}`, 'i'),
  invoiceDate: /\b(?:invoice\s*date|date\s*of\s*(?:issue|invoice)|issue\s*date|bill\s*date)\b/i,
  poDate: /\b(?:po\s*date|order\s*date|date\s*of\s*order)\b/i,
  dnDate: /\b(?:delivery\s*note\s*date|challan\s*date|dispatch\s*date|date\s*of\s*delivery|delivered\s+on)\b/i,
  dueDate: /\b(?:due\s*date|payment\s*due|pay(?:ment)?\s*by|payable\s*(?:by|on\s*or\s*before)|due\s*(?:by|on))\b/i,
  deliveryDate: /\b(?:delivery\s*(?:date|by)|deliver\s*by|expected\s*delivery)\b/i,
  hsn: /\b(?:hsn|sac)(?:\s*\/\s*(?:hsn|sac))?\b(?:\s*(?:code|no\.?))?\s*[:-]?\s*(\d{4,8})?/i,
  signature: /\b(?:authori[sz]ed\s+signat(?:ory|ure)|digitally\s+signed|signed\s+by|signature\s*:|in\s+witness\s+whereof)/i,
  receivedBy: /\breceived\s+by\b\s*[:-]?\s*(.*)$/i,
  supplier: /^\s*(?:supplier|seller|vendor|from|billed\s+by|sold\s+by)\s*(?:name)?\s*[:-]\s*/i,
  buyer: /^\s*(?:bill(?:ed)?\s+to|buyer|customer|client|recipient)\s*(?:name)?\s*[:-]\s*/i,
  placeOfSupply: /\bplace\s+of\s+supply\b\s*[:-]?\s*(.*)$/i,
  deliveryAddress: /^\s*(?:deliver(?:ed)?\s+to|ship\s+to|delivery\s+address)\s*[:-]\s*(.+)$/i,
  subtotal: /\b(?:sub\s*-?\s*total|taxable\s*(?:value|amount)|total\s+before\s+tax)\b/i,
  tax: /\b(cgst|sgst|igst|utgst|gst|vat)\b[^%\n]{0,20}?(\d{1,2}(?:\.\d{1,2})?)\s*%/i,
  total: /\b(?:grand\s*total|total\s*amount(?:\s*(?:due|payable))?|invoice\s*total|amount\s*due|net\s*payable|total\s*payable|balance\s*due|order\s*total|total)\b/i,
  totalExclude: /gstin|\btotal\s+(?:tax|gst|cgst|sgst|igst|qty|quantity|items?|hours?|units?)\b|\bsub\s*-?\s*total/i,
  roundOff: /\bround(?:ing)?\s*-?\s*off\b/i,
  discount: /\b(?:less\s*:?\s*)?discount\b/i,
  words: /\bin\s+words\b|\brupees\s+[a-z]/i,
  signFor: /^\s*for\s+(.+?)\s*$/i,
};

const ITEM_EXCLUDE = /\b(?:sub\s*-?total|total|tax|gst|cgst|sgst|igst|vat|round|discount|balance|amount\s+(?:due|in\s+words)|invoice\s*(?:no|number|date)|date|gstin|phone|pin\s*code|a\/c|ifsc|vehicle)\b/i;

function first(lines: ParsedLine[], re: RegExp): { line: ParsedLine; m: RegExpExecArray } | null {
  for (const line of lines) {
    const m = re.exec(line.text);
    if (m) return { line, m };
  }
  return null;
}

function afterLabel(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length).replace(/^\s*[:\-–#]?\s*/, '').trim();
  return rest || null;
}

/** "Sharma Office Supplies Pvt Ltd  ·  GSTIN ..." -> "Sharma Office Supplies Pvt Ltd" */
function cleanName(s: string): string {
  return s.split(/\s{2,}|\s[·|]\s|,\s*(?:gstin|pan)\b/i)[0].replace(/[.,;]$/, '').trim();
}

/** Is this the grammatical subject of a real duty ("The Provider", "Nexa"), not "It" or "This Agreement"? */
export function isPartySubject(subject: string): boolean {
  const words = subject.trim().split(/\s+/);
  const last = words[words.length - 1] ?? '';
  if (!last) return false;
  if (/^(?:it|this|that|these|those|they|which|there)$/i.test(last)) return false;
  if (/^(?:agreement|contract|clause|law|term|terms|payments?|amounts?|fees?|invoices?|obligations?|duty|services?)$/i.test(last)) return false;
  return words.length <= 6;
}

export function normalizeName(name: string | null | undefined): string {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(pvt|private|ltd|limited|llp|inc|co|company|corp|corporation|the|m\/s)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/* ------------------------------------------------------------------ */
/* Line items                                                         */
/* ------------------------------------------------------------------ */

export function extractLineItems(lines: ParsedLine[]): LineItem[] {
  const items: LineItem[] = [];
  for (const line of lines) {
    const text = line.text;
    if (!/[a-z]{3,}/i.test(text) || ITEM_EXCLUDE.test(text)) continue;
    if (findDates(text).length) continue;
    const nums = findNumbers(text).filter((n) => !/^\s?%/.test(text.slice(n.end)));
    if (nums.length < 3) continue;
    const [q, r, a] = nums.slice(-3);
    if (text.slice(a.end).trim().replace(/[|/-]/g, '')) continue; // numbers must end the line
    const description = text
      .slice(0, q.index)
      .replace(/[|]/g, ' ')
      .trim()
      .replace(/^\d{1,3}[.)]?\s+/, '')
      .replace(/\s{3,}\d{4,8}$/, '') // trailing HSN column (column gap, not 'Latitude 5440')
      .trim();
    if (!/[a-z]{3,}/i.test(description)) continue;
    items.push({ line, description, qty: q.value, rate: r.value, amount: a.value, qtyText: q.text.trim(), rateText: r.text.trim(), amountText: a.text.trim() });
  }
  return items;
}

/* ------------------------------------------------------------------ */
/* Clauses                                                            */
/* ------------------------------------------------------------------ */

const LATE_FEE = /(?:late\s+(?:payment\s+)?(?:fee|charge|interest)|interest|penalty)[^%\n]{0,60}?(\d{1,2}(?:\.\d{1,2})?)\s*%\s*(?:per|a|p\.?)\s*(month|annum|year|a\.?|m\.?)|(\d{1,2}(?:\.\d{1,2})?)\s*%\s*(?:per|a)\s*(month|annum|year)[^\n]{0,60}?(?:late|overdue|after\s+the\s+due\s+date|delay)/i;
const PER_DAY_FEE = /(?:late|delay|penalty)[^\n]{0,60}?((?:₹|Rs\.?|INR)\s?[\d,]+(?:\.\d{1,2})?)\s*(?:per|\/|a)\s*day/i;

export function findLateFee(lines: ParsedLine[]): Hit<LateFee> | undefined {
  for (const line of lines) {
    const m = LATE_FEE.exec(line.text);
    if (m) {
      const rate = Number(m[1] ?? m[3]);
      const unit = (m[2] ?? m[4]).toLowerCase();
      const kind = unit.startsWith('m') ? 'percent_month' : 'percent_year';
      return { value: { kind, rate, partThereof: /part\s+thereof/i.test(line.text) }, line, quote: m[0].trim() };
    }
    const d = PER_DAY_FEE.exec(line.text);
    if (d) {
      const rate = parseNumber(d[1]);
      if (rate) return { value: { kind: 'per_day', rate, partThereof: false }, line, quote: d[0].trim() };
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Main                                                               */
/* ------------------------------------------------------------------ */

export function extractFacts(parsed: ParsedDocument): Facts {
  const lines = parsed.pages.flatMap((p) => p.lines).filter((l) => l.text.trim());
  const { type, confidence } = classify(lines);
  const f: Facts = {
    docType: type,
    typeConfidence: confidence,
    lines,
    currency: findCurrencyAmounts(lines.map((l) => l.text).join(' '))[0]?.currency ?? 'INR',
    gstins: [],
    pans: [],
    parties: [],
    items: [],
    taxes: [],
    adjustments: [],
  };

  // ---- identifiers -------------------------------------------------
  const inv = first(lines, RE.invoiceNumber);
  if (inv) f.invoiceNumber = { value: inv.m[1].replace(/[-/]$/, ''), line: inv.line, quote: inv.m[1].replace(/[-/]$/, '') };
  const po = first(lines, RE.poNumber);
  if (po) {
    const hit = { value: po.m[1], line: po.line, quote: po.m[1] };
    if (type === 'purchase_order') f.poNumber = hit;
    else f.poReference = hit;
  }
  const dn = first(lines, RE.dnNumber);
  if (dn) {
    const v = dn.m[1] ?? dn.m[2];
    if (v) f.dnNumber = { value: v, line: dn.line, quote: v };
  }
  const ag = first(lines, RE.agreementNumber);
  if (ag) f.agreementNumber = { value: ag.m[1], line: ag.line, quote: ag.m[1] };

  for (const line of lines) {
    for (const m of line.text.matchAll(GSTIN_RE)) f.gstins.push({ value: m[1], line, quote: m[1] });
    // The PAN inside a GSTIN is glued to digits on both sides, so \b keeps it out.
    for (const m of line.text.matchAll(PAN_RE)) f.pans.push({ value: m[1], line, quote: m[1] });
  }
  if (f.gstins.length) {
    const isBuyer = (g: Hit) => /buyer|bill\s*to|customer|recipient|client/i.test(g.line.text) || (type === 'purchase_order' && !/vendor|supplier/i.test(g.line.text));
    const isSupplier = (g: Hit) => /supplier|seller|vendor|from/i.test(g.line.text);
    f.buyerGSTIN = f.gstins.find(isBuyer);
    f.supplierGSTIN = f.gstins.find(isSupplier) ?? f.gstins.find((g) => g !== f.buyerGSTIN);
  }

  // ---- parties -----------------------------------------------------
  const sup = first(lines, RE.supplier);
  if (sup) {
    const name = afterLabel(sup.line.text, RE.supplier);
    if (name) f.supplier = { value: cleanName(name), line: sup.line, quote: cleanName(name) };
  }
  const buy = first(lines, RE.buyer);
  if (buy) {
    const name = afterLabel(buy.line.text, RE.buyer);
    if (name) f.buyer = { value: cleanName(name), line: buy.line, quote: cleanName(name) };
  }
  for (const line of lines) {
    const m = RE.signFor.exec(line.text);
    if (m && /\b(?:pvt|ltd|limited|llp|inc|solutions|services|supplies|technologies|enterprises|traders|industries)\b/i.test(m[1])) {
      const name = m[1].replace(/\s*[-–(·].*$/, '').trim();
      if (!f.signingEntity) f.signingEntity = { value: name, line, quote: name };
    }
  }
  const between = first(lines, /\bbetween\s+(.+?)\s*(?:\([^)]*\))?\s+and\s+(.+?)\s*(?:\([^)]*\))?\s*[.,;]?\s*$/i);
  if (between) {
    for (const raw of [between.m[1], between.m[2]]) {
      const name = raw.replace(/\s*\(.*$/, '').replace(/[.,;]$/, '').trim();
      if (name && name.length < 80) f.parties.push({ value: name, line: between.line, quote: name });
    }
  }

  // ---- dates -------------------------------------------------------
  const dateOn = (re: RegExp, key: 'invoiceDate' | 'poDate' | 'dnDate' | 'dueDate' | 'deliveryDate') => {
    for (const line of lines) {
      if (!re.test(line.text)) continue;
      // On a combined line ("Invoice Date: 15 Sep 2026 · Due Date: ..."), take the date after the label.
      const m = re.exec(line.text)!;
      const d = findDates(line.text.slice(m.index))[0];
      if (d) {
        f[key] = { value: d.date, line, quote: d.text };
        return;
      }
    }
  };
  dateOn(RE.invoiceDate, 'invoiceDate');
  dateOn(RE.poDate, 'poDate');
  dateOn(RE.dnDate, 'dnDate');
  dateOn(RE.dueDate, 'dueDate');
  dateOn(RE.deliveryDate, 'deliveryDate');

  if (type === 'contract') {
    for (const line of lines) {
      const ds = findDates(line.text);
      if (!ds.length) continue;
      const t = line.text;
      if (!f.effectiveDate && /\b(?:effective|commenc\w*|entered\s+into|dated|made\s+on|start(?:ing)?\s+date)\b/i.test(t) && !/\brenew/i.test(t)) {
        f.effectiveDate = { value: ds[0].date, line, quote: ds[0].text };
      }
      if (!f.renewalDate && /\brenew/i.test(t)) f.renewalDate = { value: ds[ds.length - 1].date, line, quote: ds[ds.length - 1].text };
      if (!f.endDate && /\b(?:expir\w*|end\s+date|in\s+force\s+until|until|till|valid\s+up\s*to|ends?\s+on)\b/i.test(t) && !/\brenew/i.test(t)) {
        f.endDate = { value: ds[ds.length - 1].date, line, quote: ds[ds.length - 1].text };
      }
    }
  }

  // ---- GST / compliance --------------------------------------------
  const pos = first(lines, RE.placeOfSupply);
  if (pos) {
    const st = stateFromText(pos.m[1] || '');
    if (st) f.placeOfSupply = { value: st, line: pos.line, quote: pos.m[0].trim() };
  }
  const hsn = first(lines, RE.hsn);
  if (hsn) f.hsn = { value: hsn.m[1] || 'column', line: hsn.line, quote: hsn.m[0].trim() };
  const sig = first(lines, RE.signature);
  if (sig) f.signature = { value: true, line: sig.line, quote: sig.m[0] };
  const rec = first(lines, RE.receivedBy);
  if (rec && rec.m[1]?.trim()) f.receivedBy = { value: rec.m[1].trim(), line: rec.line, quote: rec.m[0].trim() };
  const addr = first(lines, RE.deliveryAddress);
  if (addr) f.deliveryAddress = { value: addr.m[1].trim(), line: addr.line, quote: addr.m[1].trim() };

  // ---- money -------------------------------------------------------
  for (const [i, line] of lines.entries()) {
    const text = line.text;
    if (RE.words.test(text) && !/\d{2,}/.test(text)) {
      // The words can wrap: "… Three Hundred Seventy" / "Six Only". Read both lines,
      // but quote only the part on the cited line (that is what the Evidence Lock checks).
      const next = lines[i + 1];
      const wraps = !/\b(?:only|paise|paisa)\b/i.test(text) && next && next.page === line.page && /^[a-z][a-z\s-]*\b(?:only|paise|paisa)\b/i.test(next.text.trim());
      const phrase = extractWordsPhrase(wraps ? `${text} ${next.text.trim()}` : text);
      const value = parseAmountInWords(phrase);
      const quote = wraps ? text.replace(/^.*?in\s+words\s*:?\s*/i, '').trim() : phrase;
      if (value != null && phrase && quote) f.amountInWords = { value, line, quote };
      continue;
    }
    if (RE.subtotal.test(text)) {
      const a = lastAmount(text);
      if (a && !f.subtotal) f.subtotal = { value: a.value, line, quote: a.text.trim() };
      continue;
    }
    const tax = RE.tax.exec(text);
    if (tax && !/\bgstin\b|\btotal\b/i.test(text)) {
      const a = lastAmount(text);
      if (a && a.value !== Number(tax[2])) {
        f.taxes.push({ kind: tax[1].toUpperCase(), rate: Number(tax[2]), value: a.value, line, quote: a.text.trim(), rateQuote: tax[0].trim() });
      }
      continue;
    }
    if (RE.roundOff.test(text) || RE.discount.test(text)) {
      const a = lastAmount(text);
      if (a && a.value) {
        const negative = RE.discount.test(text) || /\(\s*-\s*\)|(?:^|\s)[-–]\s*(?:₹|rs\.?|inr)?\s*[\d,]+(?:\.\d+)?\s*$/i.test(text);
        f.adjustments.push({ value: negative ? -Math.abs(a.value) : a.value, line, quote: a.text.trim() });
      }
      continue;
    }
    if (RE.total.test(text) && !RE.totalExclude.test(text)) {
      const a = lastAmount(text);
      if (a && a.value > 0) f.total = { value: a.value, line, quote: a.text.trim() }; // grand totals come last
    }
  }
  f.items = extractLineItems(lines);

  // ---- clauses -----------------------------------------------------
  f.lateFee = findLateFee(lines);
  for (const line of lines) {
    const t = line.text;
    if (!f.paymentTerms && /\b(?:pay|paid|payable|payment)\b/i.test(t)) {
      const d = /\bwithin\b|\bnet\b|\bfrom\b/i.test(t) ? findDurations(t)[0] : undefined;
      // "by the 7th of each month" is a payment term too (recurring rent, fees).
      const dom = /\bby\s+the\s+\d{1,2}(?:st|nd|rd|th)\s+(?:day\s+)?of\s+(?:each|every)\s+month\b/i.exec(t);
      if (d) f.paymentTerms = { value: d, line, quote: d.text };
      else if (dom) f.paymentTerms = { value: { amount: 1, unit: 'month', text: dom[0], index: dom.index }, line, quote: dom[0] };
    }
    if (!f.noticeClause && /\bnotice\b/i.test(t) && /\b(?:prior|before|preceding|in\s+advance)\b/i.test(t)) {
      const d = findDurations(t)[0];
      if (d) f.noticeClause = { value: d, line, quote: d.text };
    }
    if (!f.autoRenewal) {
      const m = /\b(?:renew\w*\s+automatically|automatic(?:ally)?\s+renew\w*|auto-?renew\w*)\b/i.exec(t);
      if (m) f.autoRenewal = { value: m[0], line, quote: m[0] };
    }
    if (!f.termination && /\bterminat/i.test(t)) f.termination = { value: t.trim(), line, quote: t.trim() };
    if (!f.governingLaw && /\b(?:governing\s+law|governed\s+by|jurisdiction|courts?\s+(?:of|at|in))\b/i.test(t)) {
      f.governingLaw = { value: t.trim(), line, quote: t.trim() };
    }
  }
  return f;
}
