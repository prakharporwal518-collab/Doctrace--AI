// Field extraction: turns lines into structured values, each one remembering
// the line it came from.

import { findCurrencyAmounts, findNumbers, lastAmount, parseNumber } from './money.js';
import { findDates } from './dates.js';
import { extractWordsPhrase, parseAmountInWords } from './words.js';

/* ------------------------------------------------------------------ */
/* Citations                                                          */
/* ------------------------------------------------------------------ */

const CLAUSE_START = /^\s*(?:clause\s+|section\s+|§\s*)?(\d{1,2}(?:\.\d{1,2}){0,3})[.)]?\s+[A-Za-z(“"]/i;

/** Map every line id to the clause number it sits under ("7.2"). */
export function buildClauseMap(doc) {
  const map = new Map();
  let current = null;
  let lastPage = null;
  for (const line of doc.lines) {
    if (line.page !== lastPage) lastPage = line.page;
    const m = CLAUSE_START.exec(line.text);
    // A bare "2026 ..." at the start of a line is a year, not a clause.
    if (m && Number(m[1].split('.')[0]) < 100) current = m[1];
    if (current) map.set(line.id, current);
  }
  return map;
}

/** Build a source object for a finding. The quote must be a piece of the line. */
export function cite(ctx, line, quote) {
  const q = (quote ?? line.text).trim();
  return {
    file: ctx.doc.name,
    docId: ctx.doc.id,
    page: line.page,
    line: line.line,
    lineId: line.id,
    clause: ctx.clauses.get(line.id) || null,
    quote: q.length > 180 ? q.slice(0, 177) + '…' : q,
  };
}

/* ------------------------------------------------------------------ */
/* Document type                                                      */
/* ------------------------------------------------------------------ */

const TYPE_KEYWORDS = {
  invoice: [/\binvoice\b/i, /\bgstin\b/i, /\bbill\s+to\b/i, /\bhsn\b|\bsac\b/i, /\bsub\s*-?total\b/i, /\bamount\s+due\b/i, /\bcgst|sgst|igst\b/i, /\bqty\b|\bquantity\b/i],
  contract: [/\bagreement\b/i, /\bshall\b/i, /\bpart(?:y|ies)\b/i, /\bterminat/i, /\bhereinafter\b|\bwhereas\b/i, /\bgoverning\s+law\b/i, /\bclause\b/i, /\bindemnif/i],
  report: [/\breport\b/i, /\bquarter\b|\bq[1-4]\b/i, /\brevenue\b/i, /\bsummary\b/i, /\bfy\s?\d{2}/i, /\bexpenses?\b/i],
  compliance: [/\bcompliance\b/i, /\bregulat/i, /\baudit\b/i, /\bfiling\b/i, /\bpolicy\b/i, /\bcircular\b/i],
};

export function classifyDocument(doc) {
  const scores = {};
  for (const [type, patterns] of Object.entries(TYPE_KEYWORDS)) {
    scores[type] = patterns.reduce((n, re) => n + (re.test(doc.text) ? 1 : 0), 0);
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [bestType, best] = ranked[0];
  const second = ranked[1][1];
  if (best === 0) return { type: 'other', confidence: 0.3, scores };
  const confidence = Math.min(0.99, 0.5 + (best - second) * 0.1 + best * 0.04);
  return { type: bestType, confidence: Number(confidence.toFixed(2)), scores };
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                      */
/* ------------------------------------------------------------------ */

function firstMatch(doc, re) {
  for (const line of doc.lines) {
    const m = re.exec(line.text);
    if (m) return { line, match: m };
  }
  return null;
}

function valueAfterLabel(text, labelRe) {
  const m = labelRe.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length).replace(/^\s*[:\-–#]?\s*/, '').trim();
  return rest || null;
}

export function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(pvt|private|ltd|limited|llp|inc|co|company|corp|corporation|the|m\/s)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/* ------------------------------------------------------------------ */
/* GSTIN                                                              */
/* ------------------------------------------------------------------ */

const GSTIN_RE = /\b(\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/g;
const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** GSTIN check digit (mod-36 Luhn variant used by the GST network). */
export function gstinCheckDigit(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const v = GST_CHARS.indexOf(first14[i]);
    if (v < 0) return null;
    const product = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36];
}

export function isValidGSTIN(gstin) {
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin || '')) return false;
  return gstinCheckDigit(gstin.slice(0, 14)) === gstin[14];
}

/* ------------------------------------------------------------------ */
/* Invoice fields                                                     */
/* ------------------------------------------------------------------ */

const LABELS = {
  invoiceNumber: /\b(?:invoice|bill|inv)\s*(?:no\b\.?|number|num\b|#)\s*[:\-#]?\s*([A-Z0-9][A-Z0-9\-/]{2,})/i,
  invoiceDate: /\b(?:invoice\s*date|date\s*of\s*(?:issue|invoice)|issue\s*date|bill\s*date|dated)\b/i,
  dueDate: /\b(?:due\s*date|payment\s*due|pay(?:ment)?\s*by|payable\s*(?:by|on\s*or\s*before)|due\s*by|due\s*on)\b/i,
  // "PO No: PO-7781", "P.O. #4471", "Purchase Order Ref - 22/B" (needs a label or a colon so "Portal" is not a PO)
  po: /(?:\bp\.\s?o\.|\bpo\b|\bpurchase\s+order\b)\s*(?:(?:no\b\.?|number|ref(?:erence)?\b\.?|#)\s*[:\-#]?|[:\-#])\s*([A-Z0-9][A-Z0-9\-/]{2,})/i,
  hsn: /\b(?:hsn|sac)(?:\s*\/\s*(?:hsn|sac))?\b(?:\s*(?:code|no\.?))?\s*[:-]?\s*(\d{4,8})?/i,
  signature: /\b(?:authori[sz]ed\s+signat(?:ory|ure)|digitally\s+signed|signed\s+by|signature\s*:)/i,
  supplier: /^\s*(?:supplier|seller|vendor|from|billed\s+by|sold\s+by)\s*(?:name)?\s*[:-]\s*/i,
  buyer: /^\s*(?:bill(?:ed)?\s+to|buyer|customer|client|recipient|ship\s+to)\s*(?:name)?\s*[:-]\s*/i,
  subtotal: /\b(?:sub\s*-?\s*total|taxable\s*(?:value|amount)|total\s+before\s+tax|net\s+amount)\b/i,
  tax: /\b(cgst|sgst|igst|utgst|gst|vat|tax)\b[^%\n]{0,20}?(\d{1,2}(?:\.\d{1,2})?)\s*%/i,
  total: /\b(?:grand\s*total|total\s*amount(?:\s*(?:due|payable))?|invoice\s*total|amount\s*due|net\s*payable|total\s*payable|balance\s*due|total\s*\(?(?:inr|incl\.?)|total)\b/i,
  roundOff: /\bround(?:ing)?\s*-?\s*off\b/i,
  discount: /\b(?:less\s*:?\s*)?discount\b/i,
  words: /\b(?:in\s+words|rupees\s+[a-z]|amount\s+chargeable)/i,
  signFor: /^\s*for\s+(.+?)\s*$/i,
};

const ITEM_EXCLUDE = /\b(?:sub\s*-?total|total|tax|gst|cgst|sgst|igst|vat|round|discount|balance|amount\s+due|invoice\s*(?:no|number|date)|date|gstin|phone|pin\s*code|po\b|p\.o\.)/i;

/** Parse invoice line items: description ... qty rate amount */
export function extractLineItems(doc) {
  const items = [];
  for (const line of doc.lines) {
    const text = line.text;
    if (!/[a-z]{3,}/i.test(text) || ITEM_EXCLUDE.test(text)) continue;
    if (findDates(text).length) continue;
    const nums = findNumbers(text).filter((n) => !/^\s?%/.test(text.slice(n.end)));
    if (nums.length < 3) continue;
    const [q, r, a] = nums.slice(-3);
    // The three numbers must be the tail of the line.
    if (text.slice(a.end).trim().replace(/[|/-]/g, '')) continue;
    // Description: everything before qty, minus a leading row number and a
    // trailing HSN/SAC code column.
    const description = text
      .slice(0, q.index)
      .replace(/[|]/g, ' ')
      .trim()
      .replace(/^\d{1,3}[.)]?\s+/, '')
      .replace(/\s+\d{4,8}$/, '')
      .trim();
    if (!/[a-z]{3,}/i.test(description)) continue;
    items.push({
      line,
      description,
      qty: q.value,
      rate: r.value,
      amount: a.value,
      amountText: a.text.trim(),
      qtyText: q.text.trim(),
      rateText: r.text.trim(),
    });
  }
  return items;
}

export function extractInvoiceFields(doc) {
  const f = {};

  const inv = firstMatch(doc, LABELS.invoiceNumber);
  if (inv) f.invoiceNumber = { value: inv.match[1].replace(/[-/]$/, ''), line: inv.line, quote: inv.match[0] };

  for (const line of doc.lines) {
    if (!f.invoiceDate && LABELS.invoiceDate.test(line.text)) {
      const d = findDates(line.text)[0];
      if (d) f.invoiceDate = { value: d.date, line, quote: d.text };
    }
    if (!f.dueDate && LABELS.dueDate.test(line.text)) {
      const d = findDates(line.text)[0];
      if (d) f.dueDate = { value: d.date, line, quote: d.text };
    }
  }
  // Fall back to the first date on the first page as the issue date.
  if (!f.invoiceDate) {
    const firstPage = doc.lines.filter((l) => l.page === 1);
    for (const line of firstPage) {
      if (LABELS.dueDate.test(line.text)) continue;
      const d = findDates(line.text)[0];
      if (d) {
        f.invoiceDate = { value: d.date, line, quote: d.text, inferred: true };
        break;
      }
    }
  }

  const po = firstMatch(doc, LABELS.po);
  if (po && !/^(box)$/i.test(po.match[1])) f.po = { value: po.match[1], line: po.line, quote: po.match[0] };

  for (const line of doc.lines) {
    const m = LABELS.hsn.exec(line.text);
    if (!m) continue;
    // Either "HSN: 998314" on one line, or an "HSN/SAC" table column header
    // followed by item rows that carry the code.
    const code = m[1] || (findNumbers(line.text).find((n) => /^\d{4,8}$/.test(n.text.trim())) || {}).text;
    f.hsn = { value: code || 'column present', line, quote: m[0].trim() };
    break;
  }

  const sig = firstMatch(doc, LABELS.signature);
  if (sig) f.signature = { value: true, line: sig.line, quote: sig.match[0] };

  // GSTINs: supplier is the one on a supplier-ish line or the first one seen.
  const gstins = [];
  for (const line of doc.lines) {
    GSTIN_RE.lastIndex = 0;
    let m;
    while ((m = GSTIN_RE.exec(line.text)) !== null) gstins.push({ value: m[1], line, quote: m[1] });
  }
  if (gstins.length) {
    const buyerIdx = gstins.findIndex((g) => /buyer|bill\s*to|customer|recipient|client/i.test(g.line.text));
    const supplierIdx = gstins.findIndex((g) => /supplier|seller|vendor|from/i.test(g.line.text));
    const sIdx = supplierIdx >= 0 ? supplierIdx : gstins.findIndex((_, i) => i !== buyerIdx);
    if (sIdx >= 0) f.supplierGSTIN = gstins[sIdx];
    if (buyerIdx >= 0) f.buyerGSTIN = gstins[buyerIdx];
    f.allGSTINs = gstins;
  }

  const sup = firstMatch(doc, LABELS.supplier);
  if (sup) {
    const name = valueAfterLabel(sup.line.text, LABELS.supplier);
    if (name) f.supplier = { value: name.replace(/\s{2,}.*/, ''), line: sup.line, quote: name.replace(/\s{2,}.*/, '') };
  }
  const buy = firstMatch(doc, LABELS.buyer);
  if (buy) {
    const name = valueAfterLabel(buy.line.text, LABELS.buyer);
    if (name) f.buyer = { value: name.replace(/\s{2,}.*/, ''), line: buy.line, quote: name.replace(/\s{2,}.*/, '') };
  }
  // "For Acme Pvt Ltd" in the signature block
  for (const line of doc.lines) {
    const m = LABELS.signFor.exec(line.text);
    if (m && /\b(?:pvt|ltd|limited|llp|inc|solutions|services|enterprises|traders|industries|technologies|co\.?)\b/i.test(m[1])) {
      f.signingEntity = { value: m[1].replace(/\s*[-–(].*$/, '').trim(), line, quote: m[1].replace(/\s*[-–(].*$/, '').trim() };
    }
  }

  // Money lines
  f.taxes = [];
  f.adjustments = [];
  for (const line of doc.lines) {
    const text = line.text;
    if (LABELS.words.test(text) && !/\d{2,}/.test(text.replace(/\d{1,2}\s*\/\s*100/, ''))) {
      const phrase = extractWordsPhrase(text);
      const value = parseAmountInWords(phrase);
      if (value != null) f.amountInWords = { value, line, quote: phrase.trim() };
      continue;
    }
    if (LABELS.subtotal.test(text)) {
      const a = lastAmount(text);
      if (a && !f.subtotal) f.subtotal = { value: a.value, line, quote: a.text.trim() };
      continue;
    }
    const tax = LABELS.tax.exec(text);
    if (tax && !/\bgstin\b/i.test(text)) {
      const a = lastAmount(text);
      if (a && a.value !== Number(tax[2])) {
        f.taxes.push({ kind: tax[1].toUpperCase(), rate: Number(tax[2]), value: a.value, line, quote: a.text.trim(), rateQuote: tax[0].trim() });
      }
      continue;
    }
    if (LABELS.roundOff.test(text) || LABELS.discount.test(text)) {
      const a = lastAmount(text);
      if (a) {
        const negative =
          LABELS.discount.test(text) ||
          /\(\s*-\s*\)|(?:^|\s)[-–]\s*(?:₹|rs\.?|inr)?\s*[\d,]+(?:\.\d+)?\s*$|\(\s*(?:₹|rs\.?|inr)?\s*[\d,]+(?:\.\d+)?\s*\)\s*$/i.test(text);
        f.adjustments.push({ value: negative ? -Math.abs(a.value) : a.value, line, quote: a.text.trim() });
      }
      continue;
    }
    if (LABELS.total.test(text) && !/gstin|\btotal\s+(?:tax|gst|cgst|sgst|igst|qty|quantity|items?|hours?|units?)\b/i.test(text)) {
      const a = lastAmount(text);
      // Prefer the last "total" line in the document: grand totals come last.
      if (a && a.value > 0) f.total = { value: a.value, line, quote: a.text.trim() };
    }
  }

  f.items = extractLineItems(doc);
  f.currency = findCurrencyAmounts(doc.text)[0]?.currency || 'INR';
  return f;
}

/* ------------------------------------------------------------------ */
/* Contract fields                                                    */
/* ------------------------------------------------------------------ */

export function extractContractFields(doc) {
  const f = {};
  for (const line of doc.lines) {
    const t = line.text;
    if (!f.parties && /\bbetween\b/i.test(t) && /\band\b/i.test(t)) {
      f.parties = { value: t.trim(), line, quote: t.trim() };
    }
    const dates = findDates(t);
    if (dates.length) {
      if (!f.effectiveDate && /\b(?:effective|commenc\w*|start(?:ing)?\s+date|entered\s+into|dated|made\s+on)\b/i.test(t) && !/\brenew/i.test(t)) {
        f.effectiveDate = { value: dates[0].date, line, quote: dates[0].text };
      }
      if (!f.renewalDate && /\brenew/i.test(t)) {
        f.renewalDate = { value: dates[0].date, line, quote: dates[0].text };
      }
      if (!f.endDate && /\b(?:expir\w*|end\s+date|terminat\w*\s+on|until|till|valid\s+up\s*to|ends?\s+on)\b/i.test(t) && !/\brenew/i.test(t)) {
        f.endDate = { value: dates[dates.length - 1].date, line, quote: dates[dates.length - 1].text };
      }
    }
    if (!f.term && /\b(?:term\s+of|period\s+of|for\s+a\s+(?:term|period))\b/i.test(t)) f.term = { value: true, line, quote: t.trim() };
    if (!f.termination && /\bterminat/i.test(t)) f.termination = { value: true, line, quote: t.trim() };
    if (!f.payment && /\b(?:payable|payment|invoice[sd]?|fees?)\b/i.test(t) && /\b(?:days?|monthly|quarterly|advance|within)\b/i.test(t)) f.payment = { value: true, line, quote: t.trim() };
    if (!f.governingLaw && /\b(?:governing\s+law|governed\s+by|jurisdiction|courts?\s+(?:of|at|in))\b/i.test(t)) f.governingLaw = { value: true, line, quote: t.trim() };
    if (!f.signature && /\b(?:in\s+witness\s+whereof|signed\s+(?:by|for)|authori[sz]ed\s+signat(?:ory|ure)|signature\s*:)/i.test(t)) f.signature = { value: true, line, quote: t.trim() };
  }
  if (!f.term && f.endDate) f.term = f.endDate;
  if (!f.term && f.renewalDate) f.term = f.renewalDate;

  // Contract rates: "at a rate of ₹2,500 per hour"
  f.rates = [];
  for (const line of doc.lines) {
    const m = /(?:rate|fee|price|charges?)[^₹$\d\n]{0,40}((?:₹|Rs\.?|INR|\$)\s?[\d,]+(?:\.\d{1,2})?)\s*(?:\/-\s*)?(?:per|\/)\s*([a-z]+)/i.exec(line.text);
    if (m) f.rates.push({ value: parseNumber(m[1]), unit: m[2].toLowerCase().replace(/s$/, ''), line, quote: m[0].trim() });
  }
  return f;
}

/* ------------------------------------------------------------------ */
/* Report fields                                                      */
/* ------------------------------------------------------------------ */

export function extractReportFields(doc) {
  const f = {};
  for (const line of doc.lines) {
    if (!f.period && /\b(?:period|quarter|fy\s?\d{2}|financial\s+year|month\s+ended|year\s+ended|as\s+(?:of|on))\b/i.test(line.text)) {
      f.period = { value: true, line, quote: line.text.trim() };
    }
    if (!f.preparedBy && /\b(?:prepared\s+by|author|submitted\s+by|approved\s+by)\b/i.test(line.text)) {
      f.preparedBy = { value: true, line, quote: line.text.trim() };
    }
    if (!f.total && /\btotal\b/i.test(line.text) && lastAmount(line.text)) {
      f.total = { value: lastAmount(line.text).value, line, quote: lastAmount(line.text).text.trim() };
    }
  }
  return f;
}
