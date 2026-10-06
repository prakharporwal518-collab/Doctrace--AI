import { describe, expect, it } from 'vitest';
import { generateSample } from '../pdfgen/generate';
import { INVOICE_0423 } from '../pdfgen/samples';
import type { FieldCandidate } from '../types';
import { processDocument } from './process';

describe('pipeline with LLM output', () => {
  it('keeps verified AI fields, discards hallucinations, and reports the counts', async () => {
    const { parsed } = await generateSample(INVOICE_0423);
    const ai: FieldCandidate[] = [
      // Real: the bank line exists at p.1 · L14.
      { category: 'identifier', label: 'IFSC', value: 'HDFC0000456', normalized_value: 'HDFC0000456', page: 1, line: 14, source_text: 'IFSC HDFC0000456', confidence: 0.9 },
      // Hallucinated: no such clause anywhere.
      { category: 'obligation', label: 'Return policy', value: '30-day returns', normalized_value: null, page: 2, line: 20, source_text: 'Goods may be returned within 30 days.', confidence: 0.8 },
      // Real quote, invented value.
      { category: 'amount', label: 'Total', value: '₹5,00,000.00', normalized_value: '500000.00', page: 2, line: 18, source_text: '₹4,82,500.00', confidence: 0.95 },
      // Duplicate of a rules field: merged, not double-counted.
      { category: 'deadline', label: 'Payment due', value: '15 Oct 2026', normalized_value: '2026-10-15', page: 1, line: 3, source_text: 'Pay by 15 Oct 2026', confidence: 0.99 },
    ];
    const out = processDocument({ userId: 'u', fileName: 'invoice_0423.pdf', mimeType: 'application/pdf', fileSize: 1, storagePath: 'x', sha256: 'h', parsed, aiCandidates: ai, engine: 'gemini', now: new Date('2026-10-06T00:00:00Z') });
    expect(out.document.engine).toBe('gemini');
    expect(out.rejected.map((r) => r.candidate.label).sort()).toEqual(['Return policy', 'Total']);
    expect(out.document.fields_discarded).toBe(2);
    const ifsc = out.extractions.find((e) => e.label === 'IFSC')!;
    expect(ifsc).toMatchObject({ source: 'gemini', page: 1, line: 14, verified: true });
    expect(ifsc.bbox).not.toBeNull();
    expect(out.extractions.filter((e) => e.label === 'Payment due')).toHaveLength(1);
    expect(out.extractions.find((e) => e.label === 'Payment due')!.source).toBe('rules');
  });

  it('flags a modified re-upload of the same file name', async () => {
    const { parsed } = await generateSample(INVOICE_0423);
    const out = processDocument({ userId: 'u', fileName: 'invoice_0423.pdf', mimeType: 'application/pdf', fileSize: 1, storagePath: 'x', sha256: 'new-hash', parsed, context: { existingInvoices: [], previousSameName: { id: 'old', sha256_hash: 'old-hash', uploaded_at: '2026-09-15T10:00:00Z' } } });
    expect(out.document.tamper_warning).toMatch(/modified since the original upload/);
  });
});
