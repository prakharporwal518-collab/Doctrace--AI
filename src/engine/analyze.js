// The DocTrace engine: Understand -> Extract -> Verify.
//
//   analyzeDocuments(docs) runs every extractor and every check, then passes
//   all findings through verifyFindings(): a finding whose quote cannot be
//   found in the line it cites is thrown away. No source, no output.

import { addDays, daysBetween, findDates, findDurations, formatDate, shiftByDuration, toISO, todayUTC } from './dates.js';
import { findCurrencyAmounts, formatMoney } from './money.js';
import {
  buildClauseMap,
  cite,
  classifyDocument,
  extractContractFields,
  extractInvoiceFields,
  extractReportFields,
} from './fields.js';
import {
  LAYERS,
  arithmeticChecks,
  batchChecks,
  contractConsistencyChecks,
  invoiceConsistencyChecks,
  missingDataChecks,
  riskClauseChecks,
} from './checks.js';

export const SEVERITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2, INFO: 3 };
export const TYPE_ORDER = { anomaly: 0, missing: 1, deadline: 2, obligation: 3, amount: 4 };

/* ------------------------------------------------------------------ */
/* Deadlines                                                          */
/* ------------------------------------------------------------------ */

const DEADLINE_WORDS = /\b(?:due|deadline|pay(?:able|ment)?\s+(?:by|before|on)|no\s+later\s+than|on\s+or\s+before|before|by|until|expir\w*|renew\w*|terminat\w*|notice|last\s+date|submit\w*|fil(?:e|ing)|deliver\w*|valid\s+(?:till|until|up\s*to)|ends?\s+on|commenc\w*|effective)\b/i;

function deadlineLabel(text) {
  const t = text.toLowerCase();
  if (/renew/.test(t)) return 'Renewal date';
  if (/terminat|notice/.test(t)) return 'Termination / notice date';
  if (/expir|valid\s+(?:till|until|up)|ends?\s+on|until/.test(t)) return 'Expiry date';
  if (/pay|due|invoice/.test(t)) return 'Payment due';
  if (/fil(?:e|ing)|submit|return/.test(t)) return 'Filing deadline';
  if (/deliver/.test(t)) return 'Delivery date';
  if (/commenc|effective|start/.test(t)) return 'Start date';
  return 'Deadline';
}

function urgency(date, now) {
  const days = daysBetween(todayUTC(now), date);
  if (days < 0) return { severity: 'HIGH', note: `overdue by ${-days} day${days === -1 ? '' : 's'}` };
  if (days <= 7) return { severity: 'HIGH', note: days === 0 ? 'due today' : `in ${days} day${days === 1 ? '' : 's'}` };
  if (days <= 30) return { severity: 'MEDIUM', note: `in ${days} days` };
  return { severity: 'INFO', note: `in ${days} days` };
}

function extractDeadlines(ctx, docType, fields, now) {
  const out = [];
  const push = (label, date, line, quote, extra = {}) => {
    const u = urgency(date, now);
    // A start date is a milestone, not something you can miss.
    const milestone = /Start date/.test(label);
    const days = daysBetween(todayUTC(now), date);
    const note = milestone ? (days < 0 ? `${-days} days ago` : u.note) : u.note;
    out.push({
      type: 'deadline', layer: LAYERS.EXTRACTION, severity: milestone ? 'INFO' : u.severity,
      label, value: formatDate(date), date: toISO(date), note,
      source: cite(ctx, line, quote), confidence: 0.94, ...extra,
    });
  };

  // Invoice due date (explicit, or derived from "within N days")
  if (docType === 'invoice') {
    if (fields.dueDate) {
      push('Payment due', fields.dueDate.value, fields.dueDate.line, fields.dueDate.quote, { confidence: 0.97 });
    } else if (fields.invoiceDate) {
      for (const line of ctx.doc.lines) {
        if (!/\b(?:within|net)\b/i.test(line.text) || !/\b(?:pay|due|payable|payment)\b/i.test(line.text)) continue;
        const d = findDurations(line.text)[0];
        if (!d) continue;
        const due = shiftByDuration(fields.invoiceDate.value, d);
        push('Payment due', due, line, d.text, {
          derived: `invoice date ${toISO(fields.invoiceDate.value)} + ${d.amount} ${d.unit}s`,
          confidence: 0.9,
        });
        break;
      }
    }
  }

  // Derived notice deadlines: "sixty (60) days' notice prior to the renewal date"
  const anchor = fields.renewalDate || fields.endDate;
  if (anchor) {
    for (const line of ctx.doc.lines) {
      if (!/\bnotice\b/i.test(line.text) || !/\b(?:prior|before|preceding|in\s+advance)\b/i.test(line.text)) continue;
      const d = findDurations(line.text)[0];
      if (!d) continue;
      const due = shiftByDuration(anchor.value, d, -1);
      const anchorName = fields.renewalDate ? 'renewal' : 'expiry';
      push('Termination notice due', due, line, d.text, {
        derived: `${anchorName} ${toISO(anchor.value)} − ${d.amount} ${d.unit}s`,
        confidence: 0.96,
      });
    }
  }

  // Every other dated line that reads like a deadline
  const taken = new Set(out.map((f) => `${f.source.lineId}|${f.date}`));
  if (docType === 'invoice' && fields.invoiceDate) taken.add(`${fields.invoiceDate.line.id}|${toISO(fields.invoiceDate.value)}`);
  for (const line of ctx.doc.lines) {
    if (!DEADLINE_WORDS.test(line.text)) continue;
    for (const d of findDates(line.text)) {
      const key = `${line.id}|${d.iso}`;
      if (taken.has(key)) continue;
      if (docType === 'invoice' && /\b(?:invoice|bill)\s*date|dated\b/i.test(line.text)) continue;
      taken.add(key);
      push(deadlineLabel(line.text), d.date, line, d.text, { confidence: 0.85 });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Obligations                                                        */
/* ------------------------------------------------------------------ */

const OBLIGATION = /\b(shall(?:\s+not)?|must(?:\s+not)?|agrees?\s+to|is\s+required\s+to|are\s+required\s+to|undertakes?\s+to|will\s+be\s+responsible\s+for|is\s+responsible\s+for|is\s+obliged\s+to)\b/i;

function extractObligations(ctx) {
  const out = [];
  for (const line of ctx.doc.lines) {
    const m = OBLIGATION.exec(line.text);
    if (!m) continue;
    // Quote the sentence around the modal verb, not the whole line.
    const text = line.text;
    // Sentence ends are a full stop followed by a space or the end of the line,
    // so "99.5%" or "1.5%" do not cut a sentence in half.
    const startIdx = Math.max(text.lastIndexOf('. ', m.index) + 1, 0);
    const tail = /\.(?=\s|$)/.exec(text.slice(m.index + m[0].length));
    const endIdx = tail ? m.index + m[0].length + tail.index + 1 : text.length;
    const sentence = text.slice(startIdx, endIdx).trim();
    const clean = sentence.replace(/^\s*(?:clause\s+)?\d+(?:\.\d+)*[.)]?\s+/i, '');
    const before = clean.slice(0, clean.toLowerCase().indexOf(m[1].toLowerCase())).trim();
    const party = before.replace(/^(?:the|each|either|both)\s+/i, '').split(/\s+/).slice(-3).join(' ') || null;
    out.push({
      type: 'obligation', layer: LAYERS.EXTRACTION, severity: 'INFO',
      label: clean.length > 120 ? clean.slice(0, 117) + '…' : clean,
      value: party ? `Party: ${party}` : null,
      source: cite(ctx, line, sentence),
      confidence: 0.88,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Financial values                                                   */
/* ------------------------------------------------------------------ */

function extractAmounts(ctx, docType, fields) {
  const out = [];
  const cur = fields.currency || 'INR';
  const add = (label, value, line, quote, confidence = 0.97) =>
    out.push({
      type: 'amount', layer: LAYERS.EXTRACTION, severity: 'INFO',
      label, value: formatMoney(value, cur), amount: value,
      source: cite(ctx, line, quote), confidence,
    });

  if (docType === 'invoice') {
    if (fields.total) add('Invoice total', fields.total.value, fields.total.line, fields.total.quote);
    if (fields.subtotal) add('Subtotal / taxable value', fields.subtotal.value, fields.subtotal.line, fields.subtotal.quote);
    for (const t of fields.taxes || []) add(`${t.kind} @ ${t.rate}%`, t.value, t.line, t.quote);
    return out;
  }

  const seen = new Set();
  for (const line of ctx.doc.lines) {
    for (const a of findCurrencyAmounts(line.text)) {
      const key = `${line.id}|${a.value}`;
      if (seen.has(key) || out.length >= 30) continue;
      seen.add(key);
      const before = line.text.slice(0, a.index).replace(/^\s*(?:clause\s+)?\d+(?:\.\d+)*[.)]?\s+/i, '').trim();
      const label = before
        ? (before.length > 60 ? '…' + before.slice(-57) : before).replace(/[:\-–,(]\s*$/, '')
        : 'Amount';
      add(label, a.value, line, a.text.trim(), 0.9);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Verification: no source, no output                                 */
/* ------------------------------------------------------------------ */

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/…$/, '')
    .trim();
}

function tokenOverlap(quote, text) {
  const q = normalize(quote).split(/[^a-z0-9₹$.,]+/).filter(Boolean);
  if (!q.length) return 0;
  const t = new Set(normalize(text).split(/[^a-z0-9₹$.,]+/).filter(Boolean));
  return q.filter((w) => t.has(w)).length / q.length;
}

export function quoteMatches(quote, lineText) {
  const q = normalize(quote);
  if (!q) return false;
  if (normalize(lineText).includes(q)) return true;
  return tokenOverlap(quote, lineText) >= 0.9;
}

function sourceIsValid(source, docsById) {
  if (!source) return false;
  if (source.schema) return Boolean(source.field);
  const doc = docsById.get(source.docId);
  const line = doc && doc.byId.get(source.lineId);
  return Boolean(line) && quoteMatches(source.quote, line.text);
}

export function verifyFindings(findings, docs) {
  const docsById = new Map(docs.map((d) => [d.id, d]));
  const accepted = [];
  const rejected = [];
  for (const f of findings) {
    if (sourceIsValid(f.source, docsById)) {
      accepted.push({ ...f, related: (f.related || []).filter((r) => sourceIsValid(r, docsById)), verified: true });
    } else {
      rejected.push(f);
    }
  }
  return { accepted, rejected };
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                      */
/* ------------------------------------------------------------------ */

function analyzeOne(doc, now) {
  const cls = classifyDocument(doc);
  const docType = cls.type;
  // Clause numbers only mean something in legal text; in an invoice a leading
  // "2" is a table row number.
  const hasClauses = docType === 'contract' || docType === 'compliance';
  const ctx = { doc, clauses: hasClauses ? buildClauseMap(doc) : new Map() };

  let fields = {};
  if (docType === 'invoice') fields = extractInvoiceFields(doc);
  else if (docType === 'contract') fields = extractContractFields(doc);
  else if (docType === 'report') fields = extractReportFields(doc);
  if (!fields.currency) fields.currency = findCurrencyAmounts(doc.text)[0]?.currency || 'INR';

  const findings = [];
  findings.push(...extractDeadlines(ctx, docType, fields, now));
  findings.push(...extractAmounts(ctx, docType, fields));

  if (docType === 'invoice') {
    findings.push(...arithmeticChecks(ctx, fields));
    findings.push(...invoiceConsistencyChecks(ctx, fields));
  }
  if (docType === 'contract' || docType === 'compliance') {
    findings.push(...extractObligations(ctx));
    findings.push(...riskClauseChecks(ctx));
  }
  if (docType === 'contract') findings.push(...contractConsistencyChecks(ctx, fields));

  const missing = missingDataChecks(ctx, docType, fields);
  findings.push(...missing.findings);

  return { doc, ctx, docType, typeConfidence: cls.confidence, fields, checklist: missing.checklist, schemaName: missing.schemaName, findings };
}

export function sortFindings(list) {
  return [...list].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
      (a.source?.page ?? 99) - (b.source?.page ?? 99) ||
      (a.source?.line ?? 999) - (b.source?.line ?? 999),
  );
}

/**
 * Analyse a batch of documents together (so cross-document checks can run).
 * One broken document never takes the others down with it.
 */
export function analyzeDocuments(docs, { now = new Date() } = {}) {
  const analyses = [];
  const errors = [];
  for (const doc of docs) {
    try {
      analyses.push(analyzeOne(doc, now));
    } catch (err) {
      errors.push({ file: doc.name, message: `Analysis failed: ${err?.message || err}` });
    }
  }

  let cross = new Map();
  try {
    cross = batchChecks(analyses);
  } catch (err) {
    errors.push({ file: 'batch', message: `Cross-document checks failed: ${err?.message || err}` });
  }

  let rejectedCount = 0;
  const results = analyses.map((a) => {
    const raw = [...a.findings, ...(cross.get(a.doc.id) || [])];
    const { accepted, rejected } = verifyFindings(raw, docs);
    rejectedCount += rejected.length;
    const findings = sortFindings(accepted).map((f, i) => ({ ...f, id: `${a.doc.id}-f${i + 1}`, file: a.doc.name, docId: a.doc.id }));
    return {
      doc: a.doc,
      docType: a.docType,
      typeConfidence: a.typeConfidence,
      schemaName: a.schemaName,
      checklist: a.checklist,
      summary: summarizeFields(a.docType, a.fields),
      findings,
    };
  });

  const all = results.flatMap((r) => r.findings);
  const today = todayUTC(now);
  const in30 = addDays(today, 30);
  const stats = {
    documents: results.length,
    deadlinesNext30: all.filter((f) => f.type === 'deadline' && f.date && f.date >= toISO(today) && f.date <= toISO(in30)).length,
    anomalies: all.filter((f) => f.type === 'anomaly').length,
    missing: all.filter((f) => f.type === 'missing').length,
    findings: all.length,
    rejected: rejectedCount,
  };
  return { results, findings: sortFindings(all), stats, errors };
}

function summarizeFields(docType, f) {
  const pick = (k) => (f[k] && f[k].value !== undefined ? f[k].value : null);
  const s = {};
  if (docType === 'invoice') {
    s['Invoice no.'] = pick('invoiceNumber');
    s.Supplier = pick('supplier');
    s['Supplier GSTIN'] = pick('supplierGSTIN');
    s['Invoice date'] = f.invoiceDate ? formatDate(f.invoiceDate.value) : null;
    s['Due date'] = f.dueDate ? formatDate(f.dueDate.value) : null;
    s.Total = f.total ? formatMoney(f.total.value, f.currency) : null;
    s['Line items'] = f.items?.length || 0;
  } else if (docType === 'contract') {
    s['Effective date'] = f.effectiveDate ? formatDate(f.effectiveDate.value) : null;
    s['Renewal date'] = f.renewalDate ? formatDate(f.renewalDate.value) : null;
    s['End date'] = f.endDate ? formatDate(f.endDate.value) : null;
    s['Rates found'] = f.rates?.length || 0;
  }
  return Object.fromEntries(Object.entries(s).filter(([, v]) => v !== null && v !== undefined));
}

/** The export shape shown on the traceability slide. */
export function toExportJSON(finding) {
  const src = finding.source || {};
  return {
    type: finding.type,
    severity: finding.severity,
    layer: finding.layer,
    label: finding.label,
    value: finding.date || finding.value || null,
    ...(finding.derived ? { derived: finding.derived } : {}),
    source: src.schema
      ? { file: src.file, schema: src.schema, field: src.field }
      : { file: src.file, page: src.page, line: src.line, ...(src.clause ? { clause: src.clause } : {}), quote: src.quote },
    confidence: finding.confidence,
  };
}
