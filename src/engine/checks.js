// The four layers of checks from the deck, plus the missing-data check:
//   1. Arithmetic      2. Consistency      3. Cross-document      4. Statistical
// Every rule returns findings that cite the exact line(s) involved.

import { formatMoney, moneyEqual, round2 } from './money.js';
import { formatDate } from './dates.js';
import { cite, isValidGSTIN, normalizeName } from './fields.js';

export const LAYERS = {
  ARITHMETIC: 'Arithmetic',
  CONSISTENCY: 'Consistency',
  CROSS_DOC: 'Cross-document',
  STATISTICAL: 'Statistical AI',
  MISSING: 'Missing data',
  EXTRACTION: 'Extraction',
};

/* ------------------------------------------------------------------ */
/* Layer 1: arithmetic                                                */
/* ------------------------------------------------------------------ */

export function arithmeticChecks(ctx, f) {
  const out = [];
  const cur = f.currency || 'INR';
  const money = (v) => formatMoney(v, cur);

  // Each line item: qty × rate = amount
  for (const item of f.items || []) {
    const expected = round2(item.qty * item.rate);
    if (!moneyEqual(item.amount, expected)) {
      out.push({
        type: 'anomaly', layer: LAYERS.ARITHMETIC, severity: 'MEDIUM',
        label: `Line amount ≠ qty × rate (${item.qtyText} × ${item.rateText} = ${money(expected)})`,
        value: money(item.amount),
        derived: `${item.qty} × ${item.rate} = ${expected}`,
        source: cite(ctx, item.line, item.amountText),
        confidence: 0.9,
      });
    }
  }

  const itemsSum = round2((f.items || []).reduce((s, i) => s + i.amount, 0));
  const taxSum = round2((f.taxes || []).reduce((s, t) => s + t.value, 0));
  const adjSum = round2((f.adjustments || []).reduce((s, a) => s + a.value, 0));
  const hasItems = (f.items || []).length > 0;

  // Σ line items vs subtotal
  if (hasItems && f.subtotal && !moneyEqual(itemsSum, f.subtotal.value)) {
    const gap = round2(f.subtotal.value - itemsSum);
    out.push({
      type: 'anomaly', layer: LAYERS.ARITHMETIC, severity: 'HIGH',
      label: `Subtotal ≠ Σ line items (${money(Math.abs(gap))} gap)`,
      value: money(f.subtotal.value),
      derived: `Σ ${f.items.length} line items = ${money(itemsSum)}`,
      source: cite(ctx, f.subtotal.line, f.subtotal.quote),
      confidence: 0.95,
    });
  }

  // GST % × taxable value = tax amount
  const taxable = f.subtotal ? f.subtotal.value : hasItems ? itemsSum : null;
  if (taxable != null) {
    for (const tax of f.taxes || []) {
      const expected = round2((taxable * tax.rate) / 100);
      if (!moneyEqual(tax.value, expected)) {
        out.push({
          type: 'anomaly', layer: LAYERS.ARITHMETIC, severity: 'HIGH',
          label: `${tax.kind} ${tax.rate}% × taxable value ≠ tax charged`,
          value: money(tax.value),
          derived: `${tax.rate}% of ${money(taxable)} = ${money(expected)}`,
          source: cite(ctx, tax.line, tax.quote),
          confidence: 0.93,
        });
      }
    }
  }

  // Total vs its parts
  if (f.total && (hasItems || f.subtotal)) {
    const base = f.subtotal ? f.subtotal.value : itemsSum;
    const expected = round2(base + taxSum + adjSum);
    if (!moneyEqual(f.total.value, expected)) {
      const gap = round2(f.total.value - expected);
      const parts = [f.subtotal ? 'subtotal' : 'Σ line items', taxSum ? 'tax' : null, adjSum ? 'adjustments' : null].filter(Boolean).join(' + ');
      out.push({
        type: 'anomaly', layer: LAYERS.ARITHMETIC, severity: 'HIGH',
        label: `Total ≠ ${parts} (${money(Math.abs(gap))} gap)`,
        value: money(f.total.value),
        derived: `${parts} = ${money(expected)}`,
        source: cite(ctx, f.total.line, f.total.quote),
        confidence: 0.95,
      });
    }
  }

  // Amount in words vs figures
  if (f.amountInWords && f.total && !moneyEqual(f.amountInWords.value, f.total.value)) {
    out.push({
      type: 'anomaly', layer: LAYERS.ARITHMETIC, severity: 'HIGH',
      label: 'Amount in words ≠ figures',
      value: `${money(f.amountInWords.value)} in words vs ${money(f.total.value)}`,
      source: cite(ctx, f.amountInWords.line, f.amountInWords.quote),
      related: [cite(ctx, f.total.line, f.total.quote)],
      confidence: 0.9,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Layer 2: consistency                                               */
/* ------------------------------------------------------------------ */

export function invoiceConsistencyChecks(ctx, f) {
  const out = [];
  if (f.invoiceDate && f.dueDate && f.dueDate.value < f.invoiceDate.value) {
    out.push({
      type: 'anomaly', layer: LAYERS.CONSISTENCY, severity: 'HIGH',
      label: 'Due date is earlier than invoice date',
      value: `${formatDate(f.dueDate.value)} < ${formatDate(f.invoiceDate.value)}`,
      source: cite(ctx, f.dueDate.line, f.dueDate.quote),
      related: [cite(ctx, f.invoiceDate.line, f.invoiceDate.quote)],
      confidence: 0.97,
    });
  }
  for (const g of f.allGSTINs || []) {
    if (!isValidGSTIN(g.value)) {
      out.push({
        type: 'anomaly', layer: LAYERS.CONSISTENCY, severity: 'MEDIUM',
        label: `GSTIN ${g.value} fails its check digit`,
        value: g.value,
        source: cite(ctx, g.line, g.quote),
        confidence: 0.92,
      });
    }
  }
  if (f.supplier && f.signingEntity) {
    const a = normalizeName(f.supplier.value);
    const b = normalizeName(f.signingEntity.value);
    if (a && b && !a.includes(b) && !b.includes(a)) {
      out.push({
        type: 'anomaly', layer: LAYERS.CONSISTENCY, severity: 'MEDIUM',
        label: 'Party name differs across the document',
        value: `"${f.supplier.value}" vs "${f.signingEntity.value}"`,
        source: cite(ctx, f.signingEntity.line, f.signingEntity.quote),
        related: [cite(ctx, f.supplier.line, f.supplier.quote)],
        confidence: 0.8,
      });
    }
  }
  return out;
}

export function contractConsistencyChecks(ctx, f) {
  const out = [];
  if (f.effectiveDate && f.endDate && f.endDate.value <= f.effectiveDate.value) {
    out.push({
      type: 'anomaly', layer: LAYERS.CONSISTENCY, severity: 'HIGH',
      label: 'Contract dates out of sequence (ends before it starts)',
      value: `${formatDate(f.effectiveDate.value)} → ${formatDate(f.endDate.value)}`,
      source: cite(ctx, f.endDate.line, f.endDate.quote),
      related: [cite(ctx, f.effectiveDate.line, f.effectiveDate.quote)],
      confidence: 0.94,
    });
  }
  if (f.effectiveDate && f.renewalDate && f.renewalDate.value <= f.effectiveDate.value) {
    out.push({
      type: 'anomaly', layer: LAYERS.CONSISTENCY, severity: 'HIGH',
      label: 'Renewal date falls before the effective date',
      value: `${formatDate(f.effectiveDate.value)} → ${formatDate(f.renewalDate.value)}`,
      source: cite(ctx, f.renewalDate.line, f.renewalDate.quote),
      related: [cite(ctx, f.effectiveDate.line, f.effectiveDate.quote)],
      confidence: 0.92,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Layer 4 (clause side): unusual / risky clauses                     */
/* ------------------------------------------------------------------ */

const RISK_CLAUSES = [
  { re: /\b(?:renew\w*\s+automatically|automatic(?:ally)?\s+renew\w*|auto-?renew\w*)\b/i, label: 'Auto-renewal clause', severity: 'MEDIUM' },
  { re: /\bunlimited\s+liability\b|\bliability\s+(?:shall\s+)?(?:not\s+be\s+|be\s+un)limited\b|\bwithout\s+(?:any\s+)?limit(?:ation)?\s+(?:of|on)\s+liability\b/i, label: 'Unlimited liability', severity: 'HIGH' },
  { re: /\bsole\s+discretion\b.*\b(?:amend|change|modify|revise)|\b(?:amend|change|modify|revise)\b.*\bat\s+any\s+time\b/i, label: 'One-sided right to change terms', severity: 'MEDIUM' },
  { re: /\bpenalt(?:y|ies)\b|\blate\s+(?:payment\s+)?(?:fee|charge)s?\b|\binterest\s+(?:at|of)\s+\d+(?:\.\d+)?\s*%/i, label: 'Penalty / late-payment charge', severity: 'LOW' },
  { re: /\bindemnif\w*/i, label: 'Indemnity obligation', severity: 'LOW' },
  { re: /\bexclusiv(?:e|ity)\b/i, label: 'Exclusivity restriction', severity: 'LOW' },
  { re: /\bnon-?refundable\b/i, label: 'Non-refundable payment', severity: 'LOW' },
];

export function riskClauseChecks(ctx) {
  const out = [];
  const seen = new Set();
  for (const line of ctx.doc.lines) {
    for (const rule of RISK_CLAUSES) {
      const m = rule.re.exec(line.text);
      if (!m || seen.has(rule.label)) continue;
      seen.add(rule.label);
      out.push({
        type: 'anomaly', layer: LAYERS.STATISTICAL, severity: rule.severity,
        label: `Unusual clause: ${rule.label.toLowerCase()}`,
        value: m[0],
        source: cite(ctx, line, m[0]),
        confidence: 0.85,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Missing-data check                                                 */
/* ------------------------------------------------------------------ */

export const SCHEMAS = {
  invoice: {
    name: 'GST invoice',
    fields: [
      { key: 'invoiceNumber', label: 'Invoice number', severity: 'HIGH' },
      { key: 'supplierGSTIN', label: 'Supplier GSTIN', severity: 'HIGH' },
      { key: 'invoiceDate', label: 'Invoice date', severity: 'HIGH' },
      { key: 'po', label: 'PO reference', severity: 'MEDIUM' },
      { key: 'hsn', label: 'HSN / SAC code', severity: 'MEDIUM' },
      { key: 'signature', label: 'Authorised signature', severity: 'MEDIUM' },
      { key: 'total', label: 'Invoice total', severity: 'HIGH' },
    ],
  },
  contract: {
    name: 'Commercial contract',
    fields: [
      { key: 'parties', label: 'Parties to the agreement', severity: 'HIGH' },
      { key: 'effectiveDate', label: 'Effective / start date', severity: 'HIGH' },
      { key: 'term', label: 'Term or end date', severity: 'MEDIUM' },
      { key: 'termination', label: 'Termination clause', severity: 'MEDIUM' },
      { key: 'payment', label: 'Payment terms', severity: 'MEDIUM' },
      { key: 'governingLaw', label: 'Governing law / jurisdiction', severity: 'LOW' },
      { key: 'signature', label: 'Signature block', severity: 'MEDIUM' },
    ],
  },
  report: {
    name: 'Business report',
    fields: [
      { key: 'period', label: 'Reporting period', severity: 'MEDIUM' },
      { key: 'preparedBy', label: 'Prepared / approved by', severity: 'LOW' },
    ],
  },
};

export function missingDataChecks(ctx, docType, f) {
  const schema = SCHEMAS[docType];
  if (!schema) return { findings: [], checklist: [] };
  const checklist = schema.fields.map((field) => {
    const hit = f[field.key];
    return {
      key: field.key,
      label: field.label,
      present: Boolean(hit),
      source: hit && hit.line ? cite(ctx, hit.line, hit.quote) : null,
    };
  });
  const findings = checklist
    .filter((c) => !c.present)
    .map((c) => {
      const field = schema.fields.find((x) => x.key === c.key);
      return {
        type: 'missing', layer: LAYERS.MISSING, severity: field.severity,
        label: `${c.label} missing`,
        value: 'not found in document',
        source: { file: ctx.doc.name, docId: ctx.doc.id, schema: schema.name, field: c.label },
        confidence: 0.88,
      };
    });
  return { findings, checklist, schemaName: schema.name };
}

/* ------------------------------------------------------------------ */
/* Layer 3 + 4: cross-document and statistical checks over a batch     */
/* ------------------------------------------------------------------ */

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * @param {Array<{doc, ctx, docType, fields}>} analyses
 * @returns {Map<docId, finding[]>}
 */
export function batchChecks(analyses) {
  const byDoc = new Map(analyses.map((a) => [a.doc.id, []]));
  const invoices = analyses.filter((a) => a.docType === 'invoice');
  const contracts = analyses.filter((a) => a.docType === 'contract');

  // Duplicate invoice numbers
  const byNumber = new Map();
  for (const a of invoices) {
    const n = a.fields.invoiceNumber?.value?.toUpperCase();
    if (!n) continue;
    if (!byNumber.has(n)) byNumber.set(n, []);
    byNumber.get(n).push(a);
  }
  for (const [num, group] of byNumber) {
    if (group.length < 2) continue;
    group.slice(1).forEach((a) => {
      const first = group[0];
      byDoc.get(a.doc.id).push({
        type: 'anomaly', layer: LAYERS.CROSS_DOC, severity: 'HIGH',
        label: `Duplicate of invoice ${num} (${first.doc.name})`,
        value: num,
        source: cite(a.ctx, a.fields.invoiceNumber.line, a.fields.invoiceNumber.quote),
        related: [cite(first.ctx, first.fields.invoiceNumber.line, first.fields.invoiceNumber.quote)],
        confidence: 0.97,
      });
    });
  }

  // Same vendor + same amount under a different invoice number: paid twice?
  for (let i = 0; i < invoices.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const a = invoices[i];
      const b = invoices[j];
      if (!a.fields.total || !b.fields.total) continue;
      const na = a.fields.invoiceNumber?.value?.toUpperCase();
      const nb = b.fields.invoiceNumber?.value?.toUpperCase();
      if (na && nb && na === nb) continue; // already reported above
      const vendorA = a.fields.supplierGSTIN?.value || normalizeName(a.fields.supplier?.value);
      const vendorB = b.fields.supplierGSTIN?.value || normalizeName(b.fields.supplier?.value);
      if (!vendorA || vendorA !== vendorB) continue;
      if (!moneyEqual(a.fields.total.value, b.fields.total.value)) continue;
      byDoc.get(a.doc.id).push({
        type: 'anomaly', layer: LAYERS.CROSS_DOC, severity: 'HIGH',
        label: `Same bill paid twice? Same vendor and amount as ${b.doc.name}`,
        value: formatMoney(a.fields.total.value, a.fields.currency),
        source: cite(a.ctx, a.fields.total.line, a.fields.total.quote),
        related: [cite(b.ctx, b.fields.total.line, b.fields.total.quote)],
        confidence: 0.82,
      });
    }
  }

  // Invoice rate ≠ contract rate
  const rates = contracts.flatMap((c) => (c.fields.rates || []).map((r) => ({ ...r, c })));
  for (const a of invoices) {
    for (const item of a.fields.items || []) {
      const desc = item.description.toLowerCase();
      const match = rates.find((r) => r.unit && new RegExp(`\\b${r.unit}s?\\b`).test(desc));
      if (match && !moneyEqual(item.rate, match.value)) {
        byDoc.get(a.doc.id).push({
          type: 'anomaly', layer: LAYERS.CROSS_DOC, severity: 'HIGH',
          label: `Invoice rate ≠ contract rate (${formatMoney(match.value, a.fields.currency)} per ${match.unit})`,
          value: `${formatMoney(item.rate, a.fields.currency)} per ${match.unit}`,
          derived: `overbilled ${formatMoney(round2((item.rate - match.value) * item.qty), a.fields.currency)} on ${item.qty} ${match.unit}s`,
          source: cite(a.ctx, item.line, item.rateText),
          related: [cite(match.c.ctx, match.line, match.quote)],
          confidence: 0.86,
        });
      }
    }
  }

  // Price spike vs vendor history (robust z-score on invoice totals)
  const byVendor = new Map();
  for (const a of invoices) {
    const v = a.fields.supplierGSTIN?.value || normalizeName(a.fields.supplier?.value);
    if (!v || !a.fields.total) continue;
    if (!byVendor.has(v)) byVendor.set(v, []);
    byVendor.get(v).push(a);
  }
  for (const group of byVendor.values()) {
    if (group.length < 4) continue;
    for (const a of group) {
      const others = group.filter((g) => g !== a).map((g) => g.fields.total.value);
      const med = median(others);
      const mad = median(others.map((x) => Math.abs(x - med)));
      const x = a.fields.total.value;
      const score = mad > 0 ? (0.6745 * (x - med)) / mad : x > med * 1.5 ? Infinity : 0;
      if (score > 3.5) {
        byDoc.get(a.doc.id).push({
          type: 'anomaly', layer: LAYERS.STATISTICAL, severity: 'MEDIUM',
          label: `Price spike vs vendor history (${(x / med).toFixed(1)}× the usual amount)`,
          value: formatMoney(x, a.fields.currency),
          derived: `median of ${others.length} other invoices = ${formatMoney(med, a.fields.currency)}`,
          source: cite(a.ctx, a.fields.total.line, a.fields.total.quote),
          confidence: 0.75,
        });
      }
    }
  }

  return byDoc;
}

