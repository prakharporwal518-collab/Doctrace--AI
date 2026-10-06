// Rules-based field extraction. Produces exactly the same JSON shape the LLM
// is asked for ({ label, value, normalized_value, page, line, source_text,
// confidence }), so both go through the same Evidence Lock.

import type { FieldCandidate } from '../types';
import { findDates, formatDate, shiftByDuration, toISO } from './dates';
import { isPartySubject, type Facts, type Hit } from './facts';
import { findCurrencyAmounts, formatINR, round2 } from './money';

const DEADLINE_WORDS = /\b(?:due|deadline|pay(?:able)?\s+(?:by|before|on)|no\s+later\s+than|on\s+or\s+before|expir\w*|renew\w*|terminat\w*|last\s+date|deliver\w*\s+by|valid\s+(?:till|until|up\s*to)|in\s+force\s+until|ends?\s+on)\b/i;
const OBLIGATION = /\b(shall(?:\s+not)?|must(?:\s+not)?|agrees?\s+to|is\s+required\s+to|undertakes?\s+to|will\s+be\s+responsible\s+for|is\s+responsible\s+for)\b/i;

function cand(
  category: FieldCandidate['category'],
  label: string,
  value: string,
  normalized: string | null,
  hit: { line: { page: number; line: number }; quote: string },
  confidence: number,
): FieldCandidate {
  return {
    category,
    label,
    value,
    normalized_value: normalized,
    page: hit.line.page,
    line: hit.line.line,
    source_text: hit.quote,
    confidence,
    origin: 'rules',
  };
}

const dateCand = (label: string, h: Hit<Date> | undefined, category: 'date' | 'deadline', conf = 0.97) =>
  h ? [cand(category, label, formatDate(h.value), toISO(h.value), h, conf)] : [];

export function extractCandidates(f: Facts): FieldCandidate[] {
  const out: FieldCandidate[] = [];
  const money = (v: number) => formatINR(v, f.currency);
  const amt = (label: string, h: Hit<number> | undefined, conf = 0.97) => {
    if (h) out.push(cand('amount', label, money(h.value), round2(h.value).toFixed(2), h, conf));
  };

  // Identifiers
  if (f.invoiceNumber) out.push(cand('identifier', 'Invoice number', f.invoiceNumber.value, f.invoiceNumber.value.toUpperCase(), f.invoiceNumber, 0.98));
  if (f.poNumber) out.push(cand('identifier', 'PO number', f.poNumber.value, f.poNumber.value.toUpperCase(), f.poNumber, 0.98));
  if (f.poReference) out.push(cand('identifier', 'PO reference', f.poReference.value, f.poReference.value.toUpperCase(), f.poReference, 0.95));
  if (f.dnNumber) out.push(cand('identifier', f.docType === 'delivery_note' ? 'Delivery note number' : 'Delivery note reference', f.dnNumber.value, f.dnNumber.value.toUpperCase(), f.dnNumber, 0.95));
  if (f.agreementNumber) out.push(cand('identifier', 'Agreement number', f.agreementNumber.value, f.agreementNumber.value, f.agreementNumber, 0.96));
  for (const g of f.gstins) {
    const label = g === f.buyerGSTIN ? 'Buyer GSTIN' : g === f.supplierGSTIN ? (f.docType === 'purchase_order' ? 'Vendor GSTIN' : 'Supplier GSTIN') : 'GSTIN';
    out.push(cand('identifier', label, g.value, g.value, g, 0.99));
  }
  for (const p of f.pans) out.push(cand('identifier', 'PAN', p.value, p.value, p, 0.96));

  // Parties
  if (f.supplier) out.push(cand('party', f.docType === 'purchase_order' ? 'Vendor' : 'Supplier', f.supplier.value, f.supplier.value, f.supplier, 0.96));
  if (f.buyer) out.push(cand('party', 'Buyer', f.buyer.value, f.buyer.value, f.buyer, 0.96));
  f.parties.forEach((p, i) => out.push(cand('party', `Party ${i + 1}`, p.value, p.value, p, 0.93)));

  // Dates and deadlines
  out.push(...dateCand('Invoice date', f.invoiceDate, 'date'));
  out.push(...dateCand('PO date', f.poDate, 'date'));
  out.push(...dateCand('Delivery note date', f.dnDate, 'date'));
  out.push(...dateCand('Effective date', f.effectiveDate, 'date', 0.95));
  out.push(...dateCand('Payment due', f.dueDate, 'deadline'));
  out.push(...dateCand(f.docType === 'purchase_order' ? 'Deliver by' : 'Delivery date', f.deliveryDate, f.docType === 'purchase_order' ? 'deadline' : 'date'));
  out.push(...dateCand('Renewal date', f.renewalDate, 'deadline', 0.95));
  out.push(...dateCand('Term ends', f.endDate, 'deadline', 0.93));

  // Derived deadline: notice before (auto-)renewal or expiry.
  const anchor = f.renewalDate ?? f.endDate;
  if (anchor && f.noticeClause) {
    const due = shiftByDuration(anchor.value, f.noticeClause.value, -1);
    out.push({
      ...cand('deadline', f.autoRenewal ? 'Notice deadline to stop auto-renewal' : 'Termination notice deadline', formatDate(due), toISO(due), f.noticeClause, 0.94),
      value: `${formatDate(due)} (${formatDate(anchor.value)} − ${f.noticeClause.value.amount} ${f.noticeClause.value.unit}s)`,
    });
  }

  // Due date derived from payment terms when no explicit due date exists.
  if (!f.dueDate && f.invoiceDate && f.paymentTerms && f.docType === 'invoice') {
    const due = shiftByDuration(f.invoiceDate.value, f.paymentTerms.value);
    out.push({
      ...cand('deadline', 'Payment due (from terms)', formatDate(due), toISO(due), f.paymentTerms, 0.9),
      value: `${formatDate(due)} (invoice date + ${f.paymentTerms.value.amount} ${f.paymentTerms.value.unit}s)`,
    });
  }

  // Money
  amt('Subtotal', f.subtotal);
  for (const t of f.taxes) out.push(cand('amount', `${t.kind} @ ${t.rate}%`, money(t.value), round2(t.value).toFixed(2), t, 0.97));
  amt(f.docType === 'purchase_order' ? 'Order total' : 'Total', f.total);
  if (f.amountInWords) out.push(cand('amount', 'Amount in words', money(f.amountInWords.value), round2(f.amountInWords.value).toFixed(2), f.amountInWords, 0.9));
  if (f.lateFee) {
    const lf = f.lateFee.value;
    const v = lf.kind === 'per_day' ? `${money(lf.rate)} per day` : `${lf.rate}% per ${lf.kind === 'percent_month' ? 'month' : 'year'}`;
    out.push(cand('amount', 'Late-payment penalty', v, JSON.stringify(lf), f.lateFee, 0.93));
  }

  // Line items
  for (const it of f.items) {
    out.push({
      ...cand('line_item', `Line item · ${it.description}`, `${it.qtyText} × ${money(it.rate)} = ${money(it.amount)}`, JSON.stringify({ description: it.description, qty: it.qty, rate: it.rate, amount: it.amount }), { line: it.line, quote: it.amountText }, 0.95),
    });
  }

  // Contracts and other prose: obligations, amounts in clauses, generic deadlines
  if (f.docType === 'contract' || f.docType === 'other') {
    for (const line of f.lines) {
      const m = OBLIGATION.exec(line.text);
      if (!m) continue;
      const text = line.text.replace(/^\s*(?:clause\s+)?\d+(?:\.\d+)*[.)]?\s+/i, '').trim();
      const subject = text.slice(0, text.toLowerCase().indexOf(m[1].toLowerCase())).trim();
      if (!isPartySubject(subject)) continue;
      out.push(cand('obligation', text.length > 110 ? `${text.slice(0, 107)}…` : text, text, null, { line, quote: text }, 0.88));
    }
    const seen = new Set(out.filter((c) => c.category === 'amount').map((c) => `${c.page}-${c.line}`));
    for (const line of f.lines) {
      for (const a of findCurrencyAmounts(line.text)) {
        if (seen.has(`${line.page}-${line.line}`)) continue;
        const before = line.text.slice(0, a.index).replace(/^\s*\d+(?:\.\d+)*[.)]?\s+/, '').trim();
        const label = before ? (before.length > 50 ? `…${before.slice(-47)}` : before).replace(/[:\-–,(]\s*$/, '') : 'Amount';
        out.push(cand('amount', label, money(a.value), round2(a.value).toFixed(2), { line, quote: a.text.trim() }, 0.9));
      }
    }
  }

  const taken = new Set(out.filter((c) => c.category === 'deadline' || c.category === 'date').map((c) => `${c.page}-${c.line}-${c.normalized_value}`));
  for (const line of f.lines) {
    if (!DEADLINE_WORDS.test(line.text)) continue;
    for (const d of findDates(line.text)) {
      const key = `${line.page}-${line.line}-${d.iso}`;
      if (taken.has(key)) continue;
      taken.add(key);
      out.push(cand('deadline', deadlineLabel(line.text), formatDate(d.date), d.iso, { line, quote: d.text }, 0.85));
    }
  }
  return out;
}

function deadlineLabel(text: string): string {
  const t = text.toLowerCase();
  if (/renew/.test(t)) return 'Renewal date';
  if (/terminat|notice/.test(t)) return 'Termination / notice date';
  if (/expir|valid|until|ends?\s+on/.test(t)) return 'Expiry date';
  if (/pay|due|invoice/.test(t)) return 'Payment due';
  if (/deliver/.test(t)) return 'Delivery date';
  return 'Deadline';
}
