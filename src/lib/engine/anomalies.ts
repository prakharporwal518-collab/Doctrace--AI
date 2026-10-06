// Deterministic Anomaly Engine. Plain code, no AI, so every flag can be
// explained exactly: the rule, the expected value, the value found, and the
// line it was found on.

import type { BBox, Citation, ParsedDocument, Severity } from '../types';
import { formatDate } from './dates';
import { locateQuote } from './evidence';
import type { Facts, Hit } from './facts';
import { normalizeName } from './facts';
import { gstinState, isValidGSTIN, isValidPAN } from './ids';
import { formatINR, moneyEqual, round2 } from './money';

export interface AnomalyDraft {
  rule_code: string;
  severity: Severity;
  title: string;
  explanation: string;
  expected_value: string | null;
  found_value: string | null;
  page: number | null;
  line: number | null;
  bbox: BBox | null;
  source_text: string | null;
  related: Citation[];
}

/** Human description of every rule, shown in the "Why was this flagged?" panel. */
export const RULES: Record<string, { name: string; rule: string }> = {
  ARITH_LINE_ITEM: { name: 'Line amount ≠ qty × rate', rule: 'For every line item, quantity × rate must equal the line amount (±₹1).' },
  ARITH_SUBTOTAL: { name: 'Subtotal ≠ Σ line items', rule: 'The subtotal must equal the sum of all line-item amounts.' },
  ARITH_TOTAL: { name: 'Total ≠ Σ line items + tax', rule: 'The total must equal the subtotal (or Σ line items) plus every tax line, plus round-off and minus discounts.' },
  GST_RATE: { name: 'GST ≠ stated rate × taxable value', rule: 'Each tax line must equal its stated rate (e.g. 9%) applied to the taxable value.' },
  GST_INTERSTATE: { name: 'Wrong GST type for the supply', rule: 'If the supplier’s state (first two digits of its GSTIN) differs from the place of supply, the supply is inter-state and must be taxed as IGST, not CGST + SGST. The reverse applies to intra-state supplies.' },
  GSTIN_INVALID: { name: 'Invalid GSTIN', rule: 'A GSTIN is 15 characters: state code, PAN, entity number, "Z", and a mod-36 check digit. The check digit must match and the state code must exist.' },
  PAN_INVALID: { name: 'Invalid PAN format', rule: 'A PAN is 5 letters, 4 digits and 1 letter, and its 4th letter must be a valid holder type (P, C, H, F, A, T, B, L, J, G or K).' },
  PAN_GSTIN_MISMATCH: { name: 'PAN does not match GSTIN', rule: 'Characters 3–12 of a GSTIN are the holder’s PAN; a PAN printed on the same document should match it.' },
  DATE_DUE_BEFORE_ISSUE: { name: 'Due date before invoice date', rule: 'A payment cannot fall due before the invoice was issued.' },
  DATE_SEQUENCE: { name: 'Contract dates out of sequence', rule: 'A contract cannot end or renew before its effective date.' },
  DUPLICATE_INVOICE: { name: 'Duplicate invoice number', rule: 'An invoice number must be unique for a supplier. The same number appears in another of your documents.' },
  WORDS_MISMATCH: { name: 'Amount in words ≠ figures', rule: 'The amount written in words must equal the total written in figures.' },
  PARTY_MISMATCH: { name: 'Party name differs', rule: 'The supplier named at the top must be the same entity that signs the document.' },
  CLAUSE_AUTO_RENEWAL: { name: 'Auto-renewal clause', rule: 'The contract renews by itself unless notice is given in time, which is easy to miss.' },
  CLAUSE_UNLIMITED_LIABILITY: { name: 'Unlimited liability', rule: 'A party accepts liability without any cap.' },
  CLAUSE_PENALTY: { name: 'Penalty / late-fee clause', rule: 'A late payment attracts a fee or interest; track the due date closely.' },
};

export interface AnomalyContext {
  /** Invoice numbers already present in the user's other documents. */
  existingInvoices: Array<{ number: string; document_id: string; file_name: string; supplierKey: string | null; citation?: Citation }>;
}

export function detectAnomalies(f: Facts, parsed: ParsedDocument, ctx: AnomalyContext = { existingInvoices: [] }): AnomalyDraft[] {
  const out: AnomalyDraft[] = [];
  const money = (v: number) => formatINR(v, f.currency);

  const at = (h: Hit<unknown> | { line: Hit['line']; quote: string }) => {
    const loc = locateQuote(parsed, h.line.page, h.line.line, h.quote);
    return { page: h.line.page, line: h.line.line, bbox: loc.bbox ?? h.line.bbox, source_text: h.line.text.trim() };
  };
  const cite = (h: { line: Hit['line']; quote: string }): Citation => {
    const a = at(h);
    return { page: a.page, line: a.line, bbox: a.bbox, source_text: a.source_text };
  };
  const push = (code: string, severity: Severity, title: string, expected: string | null, found: string | null, where: { line: Hit['line']; quote: string } | null, related: Citation[] = [], extra = '') => {
    const info = RULES[code];
    out.push({
      rule_code: code,
      severity,
      title,
      explanation: `${info.rule}${extra ? ` ${extra}` : ''}`,
      expected_value: expected,
      found_value: found,
      ...(where ? at(where) : { page: null, line: null, bbox: null, source_text: null }),
      related,
    });
  };

  // ---- Arithmetic --------------------------------------------------
  for (const it of f.items) {
    const expected = round2(it.qty * it.rate);
    if (!moneyEqual(it.amount, expected)) {
      push('ARITH_LINE_ITEM', 'medium', `Line amount ≠ qty × rate (${it.description})`, money(expected), money(it.amount), { line: it.line, quote: it.amountText }, [], `${it.qty} × ${money(it.rate)} = ${money(expected)}.`);
    }
  }
  const itemsSum = round2(f.items.reduce((s, i) => s + i.amount, 0));
  const taxSum = round2(f.taxes.reduce((s, t) => s + t.value, 0));
  const adjSum = round2(f.adjustments.reduce((s, a) => s + a.value, 0));
  const hasItems = f.items.length > 0;

  if (hasItems && f.subtotal && !moneyEqual(itemsSum, f.subtotal.value)) {
    const gap = round2(Math.abs(f.subtotal.value - itemsSum));
    push('ARITH_SUBTOTAL', 'high', `Subtotal ≠ Σ line items (${money(gap)} gap)`, money(itemsSum), money(f.subtotal.value), f.subtotal, f.items.map((i) => cite({ line: i.line, quote: i.amountText })));
  }

  const taxable = f.subtotal ? f.subtotal.value : hasItems ? itemsSum : null;
  if (taxable != null) {
    for (const t of f.taxes) {
      const expected = round2((taxable * t.rate) / 100);
      if (!moneyEqual(t.value, expected)) {
        push('GST_RATE', 'high', `${t.kind} ≠ ${t.rate}% of taxable value`, money(expected), money(t.value), t, f.subtotal ? [cite(f.subtotal)] : [], `${t.rate}% of ${money(taxable)} = ${money(expected)}.`);
      }
    }
  }

  if (f.total && (hasItems || f.subtotal)) {
    const base = f.subtotal ? f.subtotal.value : itemsSum;
    const expected = round2(base + taxSum + adjSum);
    if (!moneyEqual(f.total.value, expected)) {
      const gap = round2(Math.abs(f.total.value - expected));
      const parts = [hasItems ? `Σ line items ${money(itemsSum)}` : `subtotal ${money(base)}`, taxSum ? `tax ${money(taxSum)}` : '', adjSum ? `adjustments ${money(adjSum)}` : ''].filter(Boolean).join(' + ');
      push('ARITH_TOTAL', 'high', `Total ≠ Σ line items${taxSum ? ' + GST' : ''} (${money(gap)} gap)`, money(expected), money(f.total.value), f.total, [...(f.subtotal ? [cite(f.subtotal)] : []), ...f.taxes.map((t) => cite(t))], `Expected ${parts} = ${money(expected)}.`);
    }
  }

  if (f.amountInWords && f.total && !moneyEqual(f.amountInWords.value, f.total.value)) {
    push('WORDS_MISMATCH', 'high', 'Amount in words ≠ amount in figures', money(f.total.value), money(f.amountInWords.value), f.amountInWords, [cite(f.total)]);
  }

  // ---- GST type (inter-state vs intra-state) -----------------------
  const supplierState = gstinState(f.supplierGSTIN?.value);
  const supplyState = f.placeOfSupply?.value ?? gstinState(f.buyerGSTIN?.value);
  if (supplierState && supplyState && f.taxes.length && f.docType !== 'contract') {
    const kinds = new Set(f.taxes.map((t) => t.kind));
    const interState = supplierState.code !== supplyState.code;
    const where = f.placeOfSupply ?? f.buyerGSTIN!;
    if (interState && (kinds.has('CGST') || kinds.has('SGST'))) {
      const t = f.taxes.find((x) => x.kind === 'CGST' || x.kind === 'SGST')!;
      push('GST_INTERSTATE', 'high', 'CGST + SGST charged on an inter-state supply', `IGST (supplier in ${supplierState.name}, supply to ${supplyState.name})`, 'CGST + SGST', t, [cite(f.supplierGSTIN!), cite(where)]);
    } else if (!interState && kinds.has('IGST')) {
      const t = f.taxes.find((x) => x.kind === 'IGST')!;
      push('GST_INTERSTATE', 'medium', 'IGST charged on an intra-state supply', `CGST + SGST (both in ${supplierState.name})`, 'IGST', t, [cite(f.supplierGSTIN!), cite(where)]);
    }
  }

  // ---- Identifiers -------------------------------------------------
  for (const g of f.gstins) {
    if (!isValidGSTIN(g.value)) push('GSTIN_INVALID', 'medium', `GSTIN ${g.value} fails validation`, 'valid check digit and state code', g.value, g);
  }
  for (const line of f.lines) {
    const m = /\bPAN\b\s*(?:no\.?|number)?\s*[:-]?\s*([A-Z0-9]{8,12})\b/i.exec(line.text);
    if (!m) continue;
    const pan = m[1].toUpperCase();
    if (!isValidPAN(pan)) {
      push('PAN_INVALID', 'medium', `PAN ${pan} has an invalid format`, 'AAAAA9999A (4th letter = holder type)', pan, { line, quote: m[1] });
    } else if (f.supplierGSTIN && isValidGSTIN(f.supplierGSTIN.value) && f.supplierGSTIN.value.slice(2, 12) !== pan && f.gstins.length === 1) {
      push('PAN_GSTIN_MISMATCH', 'medium', 'PAN does not match the GSTIN', f.supplierGSTIN.value.slice(2, 12), pan, { line, quote: m[1] }, [cite(f.supplierGSTIN)]);
    }
  }

  // ---- Dates -------------------------------------------------------
  if (f.invoiceDate && f.dueDate && f.dueDate.value < f.invoiceDate.value) {
    push('DATE_DUE_BEFORE_ISSUE', 'high', 'Due date is earlier than the invoice date', `on or after ${formatDate(f.invoiceDate.value)}`, formatDate(f.dueDate.value), f.dueDate, [cite(f.invoiceDate)]);
  }
  if (f.effectiveDate) {
    for (const [h, label] of [[f.endDate, 'ends'], [f.renewalDate, 'renews']] as const) {
      if (h && h.value <= f.effectiveDate.value) {
        push('DATE_SEQUENCE', 'high', `Contract ${label} before it starts`, `after ${formatDate(f.effectiveDate.value)}`, formatDate(h.value), h, [cite(f.effectiveDate)]);
      }
    }
  }

  // ---- Cross-document: duplicate invoice number ---------------------
  if (f.invoiceNumber && f.docType === 'invoice') {
    const num = f.invoiceNumber.value.toUpperCase();
    const dup = ctx.existingInvoices.find((e) => e.number.toUpperCase() === num);
    if (dup) {
      push('DUPLICATE_INVOICE', 'high', `Duplicate of invoice ${num} in ${dup.file_name}`, 'a number not used before', num, f.invoiceNumber, dup.citation ? [{ ...dup.citation, document_id: dup.document_id, file_name: dup.file_name }] : []);
    }
  }

  // ---- Consistency: party names --------------------------------------
  if (f.supplier && f.signingEntity) {
    const a = normalizeName(f.supplier.value);
    const b = normalizeName(f.signingEntity.value);
    if (a && b && !a.includes(b) && !b.includes(a)) {
      push('PARTY_MISMATCH', 'medium', 'Supplier name differs across the document', f.supplier.value, f.signingEntity.value, f.signingEntity, [cite(f.supplier)]);
    }
  }

  // ---- Clauses -------------------------------------------------------
  if (f.docType === 'contract') {
    if (f.autoRenewal) push('CLAUSE_AUTO_RENEWAL', 'medium', 'Auto-renewal clause', 'renewal only by explicit agreement', f.autoRenewal.value, f.autoRenewal, [], f.noticeClause ? `Notice must be given ${f.noticeClause.value.amount} ${f.noticeClause.value.unit}s before renewal.` : '');
    for (const line of f.lines) {
      const m = /\bunlimited\s+liability\b|\bliability\s+(?:shall\s+)?(?:not\s+be\s+|be\s+un)limited\b/i.exec(line.text);
      if (m) {
        push('CLAUSE_UNLIMITED_LIABILITY', 'high', 'Unlimited liability clause', 'a liability cap', m[0], { line, quote: m[0] });
        break;
      }
    }
    if (f.lateFee) push('CLAUSE_PENALTY', 'low', 'Late-payment penalty clause', null, f.lateFee.quote, f.lateFee);
  }
  return out;
}
