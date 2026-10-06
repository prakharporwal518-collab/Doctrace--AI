// Upload pipeline: Uploading -> OCR -> Extracting -> Verifying -> Done.
// Each stage reports progress so the UI can show the pipeline live.

import { aiExtract, aiStatus } from '../ai';
import type { Repo } from '../data/repo';
import { IngestError, parseBuffer, sha256, validate } from '../ingest';
import { nowISO, uuid } from '../id';
import { processDocument } from '../pipeline/process';
import type { DocumentRow, Engine, FieldCandidate, Profile } from '../types';
import { assignVendor, recomputeVendors } from './vendors';

export type Stage = 'uploading' | 'ocr' | 'extracting' | 'verifying' | 'done';

export interface UploadResult {
  documentId: string;
  duplicateOf?: { id: string; uploaded_at: string };
  tamperWarning: string | null;
  fieldsExtracted: number;
  fieldsDiscarded: number;
  anomalies: number;
  trust: number | null;
  engine: Engine;
  aiNote: string | null;
  masked: number;
}

export interface UploadDeps {
  repo: Repo;
  profile: Profile;
  onStage?: (stage: Stage, detail?: string) => void;
}

/** Invoice numbers already in the library, for the duplicate-invoice rule. */
export async function existingInvoices(repo: Repo, excludeId?: string) {
  const [docs, ids] = await Promise.all([repo.listDocuments(), repo.listExtractions({ category: 'identifier' })]);
  const names = new Map(docs.map((d) => [d.id, d.file_name]));
  return ids
    .filter((e) => e.label === 'Invoice number' && e.document_id !== excludeId && names.has(e.document_id))
    .map((e) => ({ number: e.normalized_value ?? e.value, document_id: e.document_id, file_name: names.get(e.document_id)!, supplierKey: null, citation: { page: e.page, line: e.line, bbox: e.bbox, source_text: e.raw_text } }));
}

export async function uploadAndProcess(file: File, { repo, profile, onStage }: UploadDeps): Promise<UploadResult> {
  const kind = validate(file);
  onStage?.('uploading');
  const buffer = await file.arrayBuffer();
  const hash = await sha256(buffer);

  // Tamper check: same name, different bytes -> warn. Same bytes -> it's a duplicate upload.
  const sameName = await repo.findByName(file.name);
  const identical = sameName.find((d) => d.sha256_hash === hash && d.status !== 'failed');
  if (identical) {
    return { documentId: identical.id, duplicateOf: { id: identical.id, uploaded_at: identical.uploaded_at }, tamperWarning: null, fieldsExtracted: 0, fieldsDiscarded: 0, anomalies: 0, trust: identical.trust_score, engine: identical.engine, aiNote: null, masked: 0 };
  }
  const previous = sameName.filter((d) => d.status === 'ready').sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at))[0] ?? null;

  const id = uuid();
  const pending: DocumentRow = {
    id, user_id: repo.userId, file_name: file.name, file_url: '', mime_type: file.type || (kind === 'pdf' ? 'application/pdf' : 'application/octet-stream'),
    file_size: file.size, doc_type: 'other', sha256_hash: hash, page_count: 0, status: 'processing', trust_score: null, completeness: null,
    fields_extracted: 0, fields_discarded: 0, engine: 'rules', vendor_id: null, tamper_warning: null, error_message: null, pages: null, uploaded_at: nowISO(),
  };
  const path = await repo.createDocument(pending, file);
  await repo.log('upload', { file_name: file.name, size: file.size, sha256: hash }, id);

  try {
    onStage?.('ocr');
    const parsed = await parseBuffer(buffer, kind, file, (p) => {
      if (p.stage === 'ocr') onStage?.('ocr', p.pages && p.pages > 1 ? `OCR page ${p.page} of ${p.pages}` : `OCR ${Math.round((p.progress ?? 0) * 100)}%`);
    });

    onStage?.('extracting');
    let aiCandidates: FieldCandidate[] | null = null;
    let engine: Engine = 'rules';
    let aiNote: string | null = null;
    let masked = 0;
    const status = await aiStatus();
    if (status.ai) {
      try {
        const r = await aiExtract(parsed, { privacy: profile.privacy_mode });
        aiCandidates = r.fields;
        engine = r.provider;
        masked = r.masked;
      } catch (err) {
        aiNote = `AI extraction unavailable (${(err as Error).message}); the rules engine was used.`;
      }
    }

    onStage?.('verifying');
    const out = processDocument({
      documentId: id,
      userId: repo.userId,
      fileName: file.name,
      mimeType: pending.mime_type,
      fileSize: file.size,
      storagePath: path,
      sha256: hash,
      parsed,
      aiCandidates,
      engine,
      context: { existingInvoices: await existingInvoices(repo, id), previousSameName: previous, organisation: profile.organisation },
    });
    out.document.uploaded_at = pending.uploaded_at;
    await repo.completeDocument(out);
    await assignVendor(repo, id, out.vendor);
    await recomputeVendors(repo);

    await repo.log('extraction', { fields: out.extractions.length, discarded: out.rejected.length, anomalies: out.anomalies.length, missing: out.missing.length, trust_score: out.trust.score, engine, ocr: parsed.source === 'ocr', privacy_masked: masked }, id);
    if (out.rejected.length) {
      await repo.log('evidence_rejected', { count: out.rejected.length, fields: out.rejected.slice(0, 50).map((r) => ({ label: r.candidate.label, value: r.candidate.value, page: r.candidate.page, line: r.candidate.line, reason: r.reason })) }, id);
    }
    if (out.document.tamper_warning) await repo.log('tamper_warning', { file_name: file.name, previous_document: previous?.id, message: out.document.tamper_warning }, id);

    onStage?.('done');
    return { documentId: id, tamperWarning: out.document.tamper_warning, fieldsExtracted: out.extractions.length, fieldsDiscarded: out.rejected.length, anomalies: out.anomalies.length, trust: out.trust.score, engine, aiNote, masked };
  } catch (err) {
    const message = err instanceof IngestError ? err.message : `Processing failed: ${(err as Error)?.message ?? err}`;
    await repo.failDocument(id, message).catch(() => {});
    await repo.log('upload_failed', { file_name: file.name, error: message }, id).catch(() => {});
    throw err instanceof IngestError ? err : new Error(message);
  }
}
