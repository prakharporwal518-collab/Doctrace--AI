// The DocTrace pipeline after ingest:
//   facts -> rules + LLM candidates -> Evidence Lock -> anomalies -> missing data
//   -> obligations -> trust score.
// Pure and synchronous, so it runs the same in the browser, in tests and in the seed script.

import { detectAnomalies, type AnomalyContext } from '../engine/anomalies';
import { evidenceLock, locateQuote } from '../engine/evidence';
import { extractCandidates } from '../engine/extract';
import { extractFacts, normalizeName, type Facts } from '../engine/facts';
import { checkMissing, type ChecklistItem } from '../engine/missing';
import { extractObligations } from '../engine/obligations';
import { trustScore, type TrustBreakdown } from '../engine/trust';
import { uuid, nowISO } from '../id';
import type { Anomaly, DocumentRow, Engine, Extraction, FieldCandidate, MissingField, Obligation, ParsedDocument, RejectedCandidate } from '../types';

export interface ProcessInput {
  documentId?: string;
  userId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  sha256: string;
  parsed: ParsedDocument;
  aiCandidates?: FieldCandidate[] | null;
  engine?: Engine;
  context?: AnomalyContext & {
    previousSameName?: { id: string; sha256_hash: string; uploaded_at: string } | null;
    organisation?: string | null;
  };
  now?: Date;
}

export interface ProcessOutput {
  document: DocumentRow;
  extractions: Extraction[];
  anomalies: Anomaly[];
  missing: MissingField[];
  obligations: Obligation[];
  rejected: RejectedCandidate[];
  checklist: ChecklistItem[];
  schema: string | null;
  trust: TrustBreakdown;
  vendor: { name: string; gstin: string | null } | null;
  facts: Facts;
}

export function processDocument(input: ProcessInput): ProcessOutput {
  const now = input.now ?? new Date();
  const created = nowISO();
  const docId = input.documentId ?? uuid();
  const facts = extractFacts(input.parsed);

  // Rules first: when both extractors find the same fact, the deterministic one wins.
  const candidates: FieldCandidate[] = [...extractCandidates(facts), ...(input.aiCandidates ?? []).map((c) => ({ ...c, origin: input.engine ?? 'gemini' }))];
  const { accepted, rejected } = evidenceLock(candidates, input.parsed);

  const extractions: Extraction[] = accepted.map((f) => ({
    id: uuid(),
    document_id: docId,
    category: f.category,
    label: f.label,
    value: f.value,
    raw_text: input.parsed.pages.find((p) => p.number === f.page)?.lines.find((l) => l.line === f.line)?.text.trim() ?? f.source_text,
    normalized_value: f.normalized_value,
    page: f.page,
    line: f.line,
    bbox: f.bbox,
    confidence: Math.round(f.confidence * 100) / 100,
    verified: true,
    reviewer_status: 'pending',
    source: f.origin ?? 'rules',
    created_at: created,
  }));

  const anomalies: Anomaly[] = detectAnomalies(facts, input.parsed, input.context ?? { existingInvoices: [] }).map((a) => ({ ...a, id: uuid(), document_id: docId, created_at: created }));
  const { checklist, completeness, schema } = checkMissing(facts);
  const missing: MissingField[] = checklist.filter((c) => !c.present).map((c) => ({ id: uuid(), document_id: docId, field_name: c.label, why_required: c.why, severity: c.severity }));

  const obligations: Obligation[] = extractObligations(facts, now).map((o) => {
    const ext = extractions.find((e) => e.page === o.page && e.line === o.line && (e.category === 'obligation' || e.category === 'deadline'));
    const loc = o.page && o.line ? locateQuote(input.parsed, o.page, o.line, o.quote) : null;
    const { lineId: _lineId, quote: _quote, ...rest } = o;
    return { ...rest, id: uuid(), document_id: docId, extraction_id: ext?.id ?? null, bbox: loc?.bbox ?? null };
  });

  const trust = trustScore({ anomalies, missing, confidences: extractions.map((e) => e.confidence) });

  let tamper: string | null = null;
  const prev = input.context?.previousSameName;
  if (prev && prev.sha256_hash !== input.sha256) {
    tamper = `This document has been modified since the original upload on ${new Date(prev.uploaded_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} (SHA-256 changed from ${prev.sha256_hash.slice(0, 12)}… to ${input.sha256.slice(0, 12)}…).`;
  }

  const document: DocumentRow = {
    id: docId,
    user_id: input.userId,
    file_name: input.fileName,
    file_url: input.storagePath,
    mime_type: input.mimeType,
    file_size: input.fileSize,
    doc_type: facts.docType,
    sha256_hash: input.sha256,
    page_count: input.parsed.pages.length,
    status: 'ready',
    trust_score: trust.score,
    completeness,
    fields_extracted: accepted.length,
    fields_discarded: rejected.length,
    engine: input.engine ?? 'rules',
    vendor_id: null,
    tamper_warning: tamper,
    error_message: null,
    pages: input.parsed.pages,
    uploaded_at: created,
  };

  return { document, extractions, anomalies, missing, obligations, rejected, checklist, schema, trust, vendor: vendorOf(facts, input.context?.organisation), facts };
}

/** The counterparty this document is "from". */
export function vendorOf(f: Facts, organisation?: string | null): { name: string; gstin: string | null } | null {
  if (f.docType === 'invoice' || f.docType === 'purchase_order' || f.docType === 'delivery_note') {
    if (f.supplier) return { name: f.supplier.value, gstin: f.supplierGSTIN?.value ?? null };
    return null;
  }
  if (f.docType === 'contract' && f.parties.length) {
    const me = normalizeName(organisation);
    const other = f.parties.find((p) => !me || normalizeName(p.value) !== me) ?? f.parties[f.parties.length - 1];
    return { name: other.value, gstin: null };
  }
  return null;
}
