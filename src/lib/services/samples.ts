// Turn the built-in sample documents into real File objects, so they go
// through exactly the same upload pipeline (pdf.js, OCR, Evidence Lock) as a
// user's own files.

import { loadPdfJs } from '../ingest';
import { generateSample } from '../pdfgen/generate';
import { DELIVERY_NOTE, EXTRA_SAMPLES, PURCHASE_ORDER, SEED_DOCS, type SampleDoc } from '../pdfgen/samples';

export const UPLOAD_SAMPLES: Array<SampleDoc & { scanned?: boolean }> = [
  DELIVERY_NOTE,
  ...EXTRA_SAMPLES.filter((s) => s !== DELIVERY_NOTE),
  { ...PURCHASE_ORDER, key: 'po_scan', fileName: 'scanned_purchase_order.png', title: 'Scanned PO (PNG)', description: 'A photo-style PNG of PO-7781 with no text layer. Exercises OCR (Tesseract, English + Hindi).', scanned: true },
];

export async function sampleFile(sample: SampleDoc & { scanned?: boolean }): Promise<File> {
  const { bytes } = await generateSample(sample.scanned ? { ...sample, fileName: PURCHASE_ORDER.fileName } : sample);
  if (!sample.scanned) return new File([bytes as BlobPart], sample.fileName, { type: 'application/pdf' });

  // Rasterise page 1 so there is no text layer left: OCR has to do the work.
  const lib = await loadPdfJs();
  const task = lib.getDocument({ data: bytes });
  const pdf = await task.promise;
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image'))), 'image/png'));
    return new File([blob], sample.fileName, { type: 'image/png' });
  } finally {
    void task.destroy();
  }
}

export { SEED_DOCS };
