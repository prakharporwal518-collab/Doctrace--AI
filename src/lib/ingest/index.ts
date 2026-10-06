// Ingest: File -> ParsedDocument (lines with page, line number and bounding box).
//   PDF with a text layer -> pdf.js
//   Scanned PDF pages, JPG, PNG -> Tesseract.js OCR (English + Hindi), self-hosted
//   DOCX -> mammoth (text only, so no boxes; lines are still numbered)

import type { ParsedDocument, ParsedLine, ParsedPage } from '../types';
import { pageToLines, type PdfJsPage } from './pdfText';

export const MAX_BYTES = 20 * 1024 * 1024;
export const ACCEPT = '.pdf,.docx,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestError';
  }
}

export type FileKind = 'pdf' | 'docx' | 'image';

export function kindOf(file: { name: string; type?: string }): FileKind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (ext === 'pdf' || file.type === 'application/pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (['jpg', 'jpeg', 'png'].includes(ext ?? '') || /^image\/(jpeg|png)$/.test(file.type ?? '')) return 'image';
  return null;
}

/** Checks we can do before reading a single byte. */
export function validate(file: { name: string; size: number; type?: string }): FileKind {
  if (!file.size) throw new IngestError('This file is empty.');
  if (file.size > MAX_BYTES) throw new IngestError(`This file is ${(file.size / 1048576).toFixed(1)} MB. The limit is 20 MB.`);
  const kind = kindOf(file);
  if (!kind) {
    if (/\.doc$/i.test(file.name)) throw new IngestError('Old .doc files are not supported. Save it as .docx and try again.');
    throw new IngestError('Unsupported file type. Upload a PDF, DOCX, JPG or PNG.');
  }
  return kind;
}

export { sha256 } from '../hash';

/* ------------------------------------------------------------------ */
/* pdf.js                                                             */
/* ------------------------------------------------------------------ */

// The "legacy" build polyfills newer JavaScript (e.g. Map.getOrInsertComputed),
// so PDFs render in every current browser, not just the very latest.
type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJs> | null = null;

export function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')])
      .then(([lib, worker]) => {
        lib.GlobalWorkerOptions.workerSrc = worker.default;
        return lib;
      })
      .catch((err) => {
        pdfjsPromise = null;
        throw err;
      });
  }
  return pdfjsPromise;
}

export async function openPdf(data: ArrayBuffer) {
  const lib = await loadPdfJs();
  const task = lib.getDocument({ data: new Uint8Array(data.slice(0)) });
  try {
    return { pdf: await task.promise, task };
  } catch (err) {
    void task.destroy();
    const name = (err as { name?: string })?.name;
    if (name === 'PasswordException') throw new IngestError('This PDF is password-protected. Remove the password and upload it again.');
    if (name === 'InvalidPDFException') throw new IngestError('This file is not a valid PDF, or it is damaged.');
    throw new IngestError(`The PDF could not be opened (${(err as Error)?.message ?? 'unknown error'}).`);
  }
}

/* ------------------------------------------------------------------ */
/* OCR (Tesseract.js, self-hosted under /tesseract)                   */
/* ------------------------------------------------------------------ */

type TWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;
let workerPromise: Promise<TWorker> | null = null;
let ocrProgress: ((p: number) => void) | null = null;

async function getOcrWorker(): Promise<TWorker> {
  if (!workerPromise) {
    workerPromise = import('tesseract.js')
      .then(({ createWorker, OEM }) =>
        createWorker(['eng', 'hin'], OEM.LSTM_ONLY, {
          workerPath: '/tesseract/worker.min.js',
          corePath: '/tesseract/core',
          langPath: '/tesseract/lang',
          gzip: true,
          logger: (m: { status: string; progress: number }) => {
            if (m.status === 'recognizing text') ocrProgress?.(m.progress);
          },
        }),
      )
      .catch((err) => {
        workerPromise = null;
        throw new IngestError(`The OCR engine could not start (${(err as Error)?.message ?? err}). Check your connection and try again.`);
      });
  }
  return workerPromise;
}

interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** OCR a canvas into numbered lines. Coordinates are normalised to the canvas size. */
export async function ocrCanvas(canvas: HTMLCanvasElement, pageNumber: number, onProgress?: (p: number) => void): Promise<{ lines: ParsedLine[]; confidence: number }> {
  const worker = await getOcrWorker();
  ocrProgress = onProgress ?? null;
  try {
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    const W = canvas.width;
    const H = canvas.height;
    const lines: ParsedLine[] = [];
    const confs: number[] = [];
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs) {
        for (const l of para.lines) {
          const text = l.text.replace(/\s+/g, ' ').trim();
          if (!text) continue;
          const b = l.bbox as OcrBox;
          // Word-level spans let the Evidence Lock box a quote precisely.
          let cursor = 0;
          const spans = l.words.map((w) => {
            const start = text.indexOf(w.text, cursor);
            const s = start >= 0 ? start : cursor;
            cursor = s + w.text.length;
            const wb = w.bbox as OcrBox;
            return { start: s, end: s + w.text.length, x: wb.x0 / W, w: (wb.x1 - wb.x0) / W };
          });
          lines.push({ id: '', page: pageNumber, line: 0, text, bbox: { x: b.x0 / W, y: b.y0 / H, w: (b.x1 - b.x0) / W, h: (b.y1 - b.y0) / H }, spans });
          confs.push(l.confidence);
        }
      }
    }
    lines.sort((a, b) => a.bbox!.y - b.bbox!.y || a.bbox!.x - b.bbox!.x);
    lines.forEach((l, i) => {
      l.line = i + 1;
      l.id = `p${pageNumber}-L${i + 1}`;
    });
    const confidence = confs.length ? confs.reduce((s, c) => s + c, 0) / confs.length / 100 : 0;
    return { lines, confidence };
  } finally {
    ocrProgress = null;
  }
}

/* ------------------------------------------------------------------ */
/* Main entry                                                         */
/* ------------------------------------------------------------------ */

export interface ParseProgress {
  stage: 'reading' | 'ocr';
  page?: number;
  pages?: number;
  progress?: number;
}

export async function parseFile(file: File, onProgress?: (p: ParseProgress) => void): Promise<{ parsed: ParsedDocument; buffer: ArrayBuffer; kind: FileKind }> {
  const kind = validate(file);
  const buffer = await file.arrayBuffer();
  return { parsed: await parseBuffer(buffer, kind, file, onProgress), buffer, kind };
}

/** Parse bytes we already hold (the upload flow hashes them first). */
export async function parseBuffer(buffer: ArrayBuffer, kind: FileKind, file: Blob, onProgress?: (p: ParseProgress) => void): Promise<ParsedDocument> {
  onProgress?.({ stage: 'reading' });
  let parsed: ParsedDocument;
  if (kind === 'pdf') parsed = await parsePdf(buffer, onProgress);
  else if (kind === 'image') parsed = await parseImage(file, onProgress);
  else parsed = await parseDocx(buffer);

  if (!parsed.pages.some((p) => p.lines.some((l) => l.text.trim()))) {
    throw new IngestError(kind === 'docx' ? 'This Word file has no readable text.' : 'No readable text was found, even after OCR. Try a sharper scan or photo.');
  }
  return parsed;
}

async function parsePdf(buffer: ArrayBuffer, onProgress?: (p: ParseProgress) => void): Promise<ParsedDocument> {
  const { pdf, task } = await openPdf(buffer);
  try {
    const pages: ParsedPage[] = [];
    const confs: number[] = [];
    let usedOcr = false;
    const total = Math.min(pdf.numPages, 60);
    for (let i = 1; i <= total; i += 1) {
      const page = await pdf.getPage(i);
      const text = await pageToLines(page as unknown as PdfJsPage, i);
      // A page with almost no text layer is a scan: OCR it.
      if (text.lines.length < 3) {
        usedOcr = true;
        onProgress?.({ stage: 'ocr', page: i, pages: total, progress: 0 });
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport }).promise;
        const ocr = await ocrCanvas(canvas, i, (p) => onProgress?.({ stage: 'ocr', page: i, pages: total, progress: p }));
        confs.push(ocr.confidence);
        pages.push({ number: i, width: text.width, height: text.height, lines: ocr.lines });
      } else {
        pages.push({ number: i, width: text.width, height: text.height, lines: text.lines });
      }
      page.cleanup();
    }
    return { pages, source: usedOcr ? 'ocr' : 'pdf-text', ocrConfidence: confs.length ? confs.reduce((s, c) => s + c, 0) / confs.length : undefined };
  } finally {
    void task.destroy();
  }
}

async function parseImage(file: Blob, onProgress?: (p: ParseProgress) => void): Promise<ParsedDocument> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new IngestError('This image could not be decoded. Is it a real JPG or PNG?');
  }
  // Upscale small photos so OCR has enough pixels; cap very large ones.
  const scale = Math.min(3, Math.max(1, 1800 / Math.max(bitmap.width, bitmap.height)), 4000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new IngestError('Your browser could not prepare the image for OCR.');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  onProgress?.({ stage: 'ocr', page: 1, pages: 1, progress: 0 });
  const ocr = await ocrCanvas(canvas, 1, (p) => onProgress?.({ stage: 'ocr', page: 1, pages: 1, progress: p }));
  return { pages: [{ number: 1, width: bitmap.width, height: bitmap.height, lines: ocr.lines }], source: 'ocr', ocrConfidence: ocr.confidence };
}

const DOCX_LINES_PER_PAGE = 46;

async function parseDocx(buffer: ArrayBuffer): Promise<ParsedDocument> {
  let mammoth: { extractRawText(o: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }> };
  try {
    mammoth = ((await import('mammoth/mammoth.browser.js')) as { default: typeof mammoth }).default;
  } catch {
    throw new IngestError('The Word reader could not be loaded. Check your connection and try again.');
  }
  let text: string;
  try {
    text = (await mammoth.extractRawText({ arrayBuffer: buffer })).value;
  } catch {
    throw new IngestError('This .docx file could not be read. It may be damaged.');
  }
  const raw = text.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
  const pages: ParsedPage[] = [];
  for (let i = 0; i < raw.length; i += DOCX_LINES_PER_PAGE) {
    const number = pages.length + 1;
    pages.push({
      number,
      width: 595,
      height: 842,
      lines: raw.slice(i, i + DOCX_LINES_PER_PAGE).map((t, k) => ({ id: `p${number}-L${k + 1}`, page: number, line: k + 1, text: t.trim(), bbox: null })),
    });
  }
  return { pages: pages.length ? pages : [{ number: 1, width: 595, height: 842, lines: [] }], source: 'docx' };
}
