// The seed and the upload pipeline must see the same lines: generate every
// sample PDF, read it back with real pdf.js, and compare line by line.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { pageToLines, type PdfJsPage } from '../ingest/pdfText';
import { sha256 } from '../hash';
import { generateSample } from './generate';
import { EXTRA_SAMPLES, INVOICE_0423, SEED_DOCS } from './samples';

describe('generated sample PDFs', () => {
  for (const sample of [...SEED_DOCS, ...EXTRA_SAMPLES]) {
    it(`${sample.fileName}: pdf.js reads the same lines and positions`, async () => {
      const { bytes, parsed } = await generateSample(sample);
      const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true });
      const pdf = await task.promise;
      try {
        expect(pdf.numPages).toBe(parsed.pages.length);
        for (let i = 1; i <= pdf.numPages; i += 1) {
          const got = await pageToLines((await pdf.getPage(i)) as unknown as PdfJsPage, i);
          const want = parsed.pages[i - 1].lines;
          expect(got.lines.map((l) => l.text)).toEqual(want.map((l) => l.text));
          got.lines.forEach((l, k) => {
            expect(Math.abs(l.bbox!.y - want[k].bbox!.y)).toBeLessThan(0.004);
            expect(Math.abs(l.bbox!.x - want[k].bbox!.x)).toBeLessThan(0.004);
          });
        }
      } finally {
        await task.destroy();
      }
    });
  }

  it('produces identical bytes every time (stable SHA-256 for the tamper check)', async () => {
    const a = await generateSample(INVOICE_0423);
    const b = await generateSample(INVOICE_0423);
    expect(await sha256(a.bytes)).toBe(await sha256(b.bytes));
  });

  it('cites the specified lines', async () => {
    const { parsed } = await generateSample(INVOICE_0423);
    expect(parsed.pages[0].lines[2].text).toBe('Pay by 15 Oct 2026');
    expect(parsed.pages[1].lines[17].text).toMatch(/^Total amount payable\s+₹4,82,500\.00$/);
  });
});
