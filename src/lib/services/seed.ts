// Demo data. Generates the three sample PDFs, runs them through the same
// pipeline as real uploads, and adds the review, chat and audit history the
// demo needs. Runs in the browser ("Try Demo Account", "Reset demo data") and
// in Node (npm run seed), against either repository.

import type { Repo } from '../data/repo';
import { locateQuote } from '../engine/evidence';
import { sha256 } from '../hash';
import { nowISO, uuid } from '../id';
import { generateSample } from '../pdfgen/generate';
import { SEED_DOCS, type SampleDoc } from '../pdfgen/samples';
import { processDocument, type ProcessOutput } from '../pipeline/process';
import type { ChatMessage, Citation, DocumentRow, ParsedDocument } from '../types';
import { assignVendor, recomputeVendors } from './vendors';

export const DEMO_PROFILE = { full_name: 'Aarav Mehta', organisation: 'Nexa Technologies', role: 'reviewer' as const, language: 'en' as const };

function cite(parsed: ParsedDocument, page: number, line: number, quote?: string): Citation {
  const l = parsed.pages.find((p) => p.number === page)?.lines.find((x) => x.line === line);
  if (!l) throw new Error(`Seed citation p.${page} L${line} does not exist`);
  const loc = locateQuote(parsed, page, line, quote ?? l.text);
  return { page, line, bbox: loc.bbox ?? l.bbox, source_text: l.text };
}

/** Process one sample document and store it, exactly like an upload would. */
export async function storeSample(repo: Repo, sample: SampleDoc, organisation: string | null): Promise<{ out: ProcessOutput; parsed: ParsedDocument }> {
  const { bytes, parsed } = await generateSample(sample);
  const hash = await sha256(bytes);
  const id = uuid();
  const docs = await repo.listDocuments();
  const ids = await repo.listExtractions({ category: 'identifier' });
  const names = new Map(docs.map((d) => [d.id, d.file_name]));
  const existing = ids
    .filter((e) => e.label === 'Invoice number' && names.has(e.document_id))
    .map((e) => ({ number: e.normalized_value ?? e.value, document_id: e.document_id, file_name: names.get(e.document_id)!, supplierKey: null, citation: { page: e.page, line: e.line, bbox: e.bbox, source_text: e.raw_text } }));

  const out = processDocument({
    documentId: id, userId: repo.userId, fileName: sample.fileName, mimeType: 'application/pdf', fileSize: bytes.byteLength,
    storagePath: '', sha256: hash, parsed, context: { existingInvoices: existing, organisation },
  });
  const pending: DocumentRow = { ...out.document, status: 'processing', pages: null };
  const path = await repo.createDocument(pending, new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  out.document.file_url = path;
  await repo.completeDocument(out);
  await assignVendor(repo, id, out.vendor);
  return { out, parsed };
}

export async function seedDemoData(repo: Repo, onProgress?: (msg: string) => void): Promise<void> {
  onProgress?.('Clearing old demo data…');
  await repo.resetAll();
  await repo.updateProfile(DEMO_PROFILE);

  const stored: Record<string, { out: ProcessOutput; parsed: ParsedDocument }> = {};
  for (const sample of SEED_DOCS) {
    onProgress?.(`Generating ${sample.fileName}…`);
    const r = await storeSample(repo, sample, DEMO_PROFILE.organisation);
    stored[sample.key] = r;
    const o = r.out;
    await repo.log('upload', { file_name: sample.fileName, size: o.document.file_size, sha256: o.document.sha256_hash }, o.document.id);
    await repo.log('extraction', { fields: o.extractions.length, discarded: o.rejected.length, anomalies: o.anomalies.length, missing: o.missing.length, trust_score: o.trust.score, engine: 'rules' }, o.document.id);
  }
  await recomputeVendors(repo);

  const inv = stored.invoice;
  const msa = stored.contract;
  const po = stored.po;

  // Three-way match: PO-7781 is linked to invoice INV-0423.
  await repo.saveMatchGroup({ id: uuid(), user_id: repo.userId, po_id: po.out.document.id, invoice_id: inv.out.document.id, delivery_id: null, created_at: nowISO() });

  // The PO delivery happened (the invoice records delivery on 18 Sep), so mark it done.
  const delivery = po.out.obligations.find((o) => /^Deliver/.test(o.action));
  if (delivery) await repo.updateObligation(delivery.id, { status: 'done' });

  // Human-in-the-loop history: a reviewer approved three fields and corrected one.
  onProgress?.('Adding review history…');
  const byLabel = (o: ProcessOutput, label: string) => o.extractions.find((e) => e.label === label);
  const approved = ['Total', 'Payment due', 'Supplier GSTIN'].map((l) => byLabel(inv.out, l)).filter(Boolean);
  for (const e of approved) await repo.updateExtraction(e!.id, { reviewer_status: 'approved' });
  const buyer = byLabel(inv.out, 'Buyer');
  if (buyer) {
    await repo.updateExtraction(buyer.id, { reviewer_status: 'corrected', value: 'Nexa Technologies Pvt Ltd' });
    await repo.addCorrection({ id: uuid(), extraction_id: buyer.id, user_id: repo.userId, old_value: buyer.value, new_value: 'Nexa Technologies Pvt Ltd', created_at: nowISO() });
  }
  await repo.log('review', { approved: approved.map((e) => e!.label), corrected: buyer ? [{ label: 'Buyer', from: buyer.value, to: 'Nexa Technologies Pvt Ltd' }] : [] }, inv.out.document.id);

  // Three Ask-the-Document conversations, each answer grounded in cited lines.
  onProgress?.('Adding sample questions…');
  const t0 = Date.now();
  const msg = (docId: string, role: 'user' | 'assistant', content: string, citations: Citation[], k: number): ChatMessage => ({
    id: uuid(), document_id: docId, user_id: repo.userId, role, content, citations, created_at: new Date(t0 + k * 1000).toISOString(),
  });
  const invId = inv.out.document.id;
  const msaId = msa.out.document.id;
  await repo.addChatMessages([
    msg(invId, 'user', 'When is the payment due?', [], 0),
    msg(invId, 'assistant', 'Payment is due by 15 Oct 2026. After that, interest of 18% per annum applies to the amount outstanding.', [cite(inv.parsed, 1, 3), cite(inv.parsed, 1, 13)], 1),
    msg(invId, 'user', 'Is the total amount correct?', [], 2),
    msg(invId, 'assistant', 'No. The invoice states ₹4,82,500.00, but the subtotal of ₹4,00,000.00 plus CGST ₹36,000.00 and SGST ₹36,000.00 adds up to ₹4,72,000.00, so the total is overstated by ₹10,500.00.', [cite(inv.parsed, 2, 18), cite(inv.parsed, 2, 12), cite(inv.parsed, 2, 13), cite(inv.parsed, 2, 14)], 3),
    msg(msaId, 'user', 'देर से भुगतान पर कितना जुर्माना लगेगा?', [], 4),
    msg(msaId, 'assistant', 'देर से भुगतान पर बकाया राशि पर हर महीने 2% विलंब शुल्क लगेगा। ₹1,50,000 की तिमाही फीस पर यह हर महीने ₹3,000 होता है (2% × ₹1,50,000)।', [cite(msa.parsed, 3, 4), cite(msa.parsed, 3, 2)], 5),
  ]);

  await repo.log('export', { format: 'pdf', report: 'Evidence Pack', file_name: 'invoice_0423.pdf', findings: inv.out.anomalies.length + inv.out.missing.length }, invId);
  onProgress?.('Demo data ready.');
}

