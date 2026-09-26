// Ingest: turn an uploaded File into a DocTrace document.
// Every failure is converted into a DocTraceError with a message a user can
// act on ("this PDF is password-protected"), never a raw stack trace.

import { buildDocument, documentFromText, isEmptyDocument } from './document.js';

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_FILES = 20;

export class DocTraceError extends Error {
  constructor(message, code = 'ERROR') {
    super(message);
    this.name = 'DocTraceError';
    this.code = code;
  }
}

const TEXT_EXT = ['txt', 'md', 'text', 'log', 'eml'];
const CSV_EXT = ['csv', 'tsv'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp', 'heic'];

export const ACCEPT = '.pdf,.docx,.txt,.md,.csv,.tsv,.eml,text/plain,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function extensionOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

/** Check a file before reading it. Throws DocTraceError when it cannot be used. */
export function validateFile(file) {
  if (!file) throw new DocTraceError('No file was provided.', 'NO_FILE');
  const ext = extensionOf(file.name);
  if (file.size === 0) throw new DocTraceError('The file is empty (0 bytes).', 'EMPTY');
  if (file.size > MAX_FILE_BYTES) {
    throw new DocTraceError(`The file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${MAX_FILE_BYTES / 1048576} MB.`, 'TOO_LARGE');
  }
  if (IMAGE_EXT.includes(ext) || /^image\//.test(file.type || '')) {
    throw new DocTraceError('Images and phone photos need OCR (PaddleOCR on the server), which is not part of this browser demo yet. Upload a PDF with a text layer, a DOCX, CSV or TXT file.', 'NEEDS_OCR');
  }
  if (ext === 'doc') throw new DocTraceError('Old .doc files are not supported. Save the file as .docx and upload it again.', 'UNSUPPORTED');
  if (['xls', 'xlsx', 'xlsm'].includes(ext)) throw new DocTraceError('Excel files are not supported directly yet. Export the sheet as CSV and upload that.', 'UNSUPPORTED');
  if (!['pdf', 'docx', ...TEXT_EXT, ...CSV_EXT].includes(ext)) {
    throw new DocTraceError(`".${ext || '?'}" files are not supported. Use PDF, DOCX, CSV or TXT.`, 'UNSUPPORTED');
  }
  return ext;
}

/* ------------------------------------------------------------------ */
/* CSV                                                                */
/* ------------------------------------------------------------------ */

/** RFC-4180-ish CSV parser: handles quoted fields, escaped quotes and newlines in quotes. */
export function parseCSV(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function csvToDocument(name, text, delimiter = ',') {
  const rows = parseCSV(text, delimiter);
  // Cells are joined with wide gaps so numbers in adjacent columns stay separate.
  const lines = rows.map((cells) => cells.map((c) => c.replace(/\s+/g, ' ').trim()).join('    '));
  return buildDocument(name, [lines], { format: 'csv' });
}

/* ------------------------------------------------------------------ */
/* PDF                                                                */
/* ------------------------------------------------------------------ */

let pdfjsPromise = null;
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
      .then(([pdfjs, worker]) => {
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        return pdfjs;
      })
      .catch((err) => {
        pdfjsPromise = null; // allow a retry after a network hiccup
        throw err;
      });
  }
  return pdfjsPromise;
}

/** Group positioned text items into reading-order lines. Exported for tests. */
export function itemsToLines(items) {
  const rows = [];
  const cleaned = items
    .filter((it) => it && typeof it.str === 'string' && it.str.trim() !== '' && Array.isArray(it.transform))
    .map((it) => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width || it.str.length * 5,
      h: Math.abs(it.height || it.transform[3] || 10),
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  for (const it of cleaned) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(2, Math.min(r.h, it.h) * 0.5));
    if (row) row.items.push(it);
    else rows.push({ y: it.y, h: it.h, items: [it] });
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) => {
      const parts = r.items.sort((a, b) => a.x - b.x);
      let out = '';
      let lastEnd = null;
      for (const p of parts) {
        if (lastEnd !== null) {
          const gap = p.x - lastEnd;
          const charW = p.w / Math.max(1, p.str.length);
          // Wide gaps are table columns: keep them visibly separate.
          if (gap > charW * 2.5) out += '    ';
          else if (gap > charW * 0.2 && !out.endsWith(' ') && !p.str.startsWith(' ')) out += ' ';
        }
        out += p.str;
        lastEnd = p.x + p.w;
      }
      return out.replace(/\s+$/, '');
    });
}

async function pdfToDocument(file) {
  let pdfjs;
  try {
    pdfjs = await loadPdfjs();
  } catch {
    throw new DocTraceError('The PDF reader could not be loaded. Check your connection and try again.', 'LOADER');
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (err) {
    safeDestroy(task);
    if (err?.name === 'PasswordException') throw new DocTraceError('This PDF is password-protected. Remove the password and upload it again.', 'PASSWORD');
    if (err?.name === 'InvalidPDFException') throw new DocTraceError('This file is not a valid PDF, or it is damaged.', 'CORRUPT');
    throw new DocTraceError(`The PDF could not be opened (${err?.message || 'unknown error'}).`, 'PDF');
  }
  try {
    const maxPages = Math.min(pdf.numPages, 200);
    const pages = [];
    for (let i = 1; i <= maxPages; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(itemsToLines(content.items));
      page.cleanup();
    }
    const doc = buildDocument(file.name, pages, { format: 'pdf' });
    if (isEmptyDocument(doc)) {
      throw new DocTraceError('This PDF has no text layer. It looks like a scan, which needs OCR (on the roadmap). Try a digitally generated PDF.', 'NEEDS_OCR');
    }
    return doc;
  } finally {
    safeDestroy(task);
  }
}

// Free the PDF worker's memory. Cleanup must never turn a good parse into an
// error, so every failure here is swallowed.
function safeDestroy(task) {
  try {
    const result = task?.destroy?.();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* DOCX                                                               */
/* ------------------------------------------------------------------ */

async function docxToDocument(file) {
  let mammoth;
  try {
    mammoth = (await import('mammoth/mammoth.browser.js')).default;
  } catch {
    throw new DocTraceError('The Word reader could not be loaded. Check your connection and try again.', 'LOADER');
  }
  let result;
  try {
    result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  } catch {
    throw new DocTraceError('This .docx file could not be read. It may be damaged or not a real Word document.', 'CORRUPT');
  }
  // mammoth separates paragraphs with a blank line; one paragraph = one line.
  const text = String(result?.value || '').replace(/\n{2,}/g, '\n');
  return documentFromText(file.name, text, { format: 'docx' });
}

/* ------------------------------------------------------------------ */
/* Entry point                                                        */
/* ------------------------------------------------------------------ */

export async function parseFile(file) {
  const ext = validateFile(file);
  let doc;
  try {
    if (ext === 'pdf') doc = await pdfToDocument(file);
    else if (ext === 'docx') doc = await docxToDocument(file);
    else if (CSV_EXT.includes(ext)) doc = csvToDocument(file.name, await file.text(), ext === 'tsv' ? '\t' : ',');
    else doc = documentFromText(file.name, await file.text(), { format: 'text' });
  } catch (err) {
    if (err instanceof DocTraceError) throw err;
    throw new DocTraceError(`Could not read this file (${err?.message || 'unknown error'}).`, 'READ');
  }
  if (isEmptyDocument(doc)) throw new DocTraceError('No readable text was found in this file.', 'EMPTY');
  if (/�{3,}/.test(doc.text.slice(0, 2000))) {
    throw new DocTraceError('This file does not look like plain text (it may be binary or use an unsupported encoding).', 'ENCODING');
  }
  return doc;
}
