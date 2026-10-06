// Renders a SampleDoc to a real PDF with jsPDF, and returns the exact line
// layout (text + bounding boxes) alongside it. The layout matches what pdf.js
// extracts from the same file (tested in pdfgen.test.ts), so seeded documents
// behave exactly like uploaded ones.

import { jsPDF } from 'jspdf';
import type { ParsedDocument, ParsedLine, Span } from '../types';
import type { Row, SampleDoc, Style } from './samples';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;
const TOP = 64;

const STYLE: Record<Style, { font: 'serif' | 'serifBold'; size: number; color: [number, number, number] }> = {
  title: { font: 'serifBold', size: 17, color: [20, 24, 36] },
  h: { font: 'serifBold', size: 11, color: [20, 24, 36] },
  body: { font: 'serif', size: 10, color: [34, 38, 50] },
  b: { font: 'serifBold', size: 10, color: [20, 24, 36] },
  small: { font: 'serif', size: 8.5, color: [90, 96, 110] },
  footer: { font: 'serif', size: 8, color: [120, 126, 140] },
};

/** The gap pdf.js-based ingest inserts between table columns. Keep in sync with ingest/pdf.ts. */
export const COLUMN_GAP = '    ';

let fontsPromise: Promise<typeof import('./fonts')> | null = null;
const loadFonts = () => (fontsPromise ??= import('./fonts'));

async function newDoc(): Promise<jsPDF> {
  const fonts = await loadFonts();
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  pdf.addFileToVFS('DejaVuSerif.ttf', fonts.serif);
  pdf.addFont('DejaVuSerif.ttf', 'serif', 'normal');
  pdf.addFileToVFS('DejaVuSerif-Bold.ttf', fonts.serifBold);
  pdf.addFont('DejaVuSerif-Bold.ttf', 'serifBold', 'normal');
  pdf.addFileToVFS('DejaVuSans.ttf', fonts.sans);
  pdf.addFont('DejaVuSans.ttf', 'sans', 'normal');
  pdf.addFileToVFS('DejaVuSans-Bold.ttf', fonts.sansBold);
  pdf.addFont('DejaVuSans-Bold.ttf', 'sansBold', 'normal');
  return pdf;
}

export { newDoc as createPdfWithFonts };

export interface GeneratedSample {
  bytes: Uint8Array;
  parsed: ParsedDocument;
}

export async function generateSample(doc: SampleDoc): Promise<GeneratedSample> {
  const pdf = await newDoc();
  pdf.setProperties({ title: doc.title, creator: 'DocTrace AI sample generator', author: 'DocTrace AI' });
  // Fixed metadata makes the bytes (and so the SHA-256) reproducible.
  pdf.setCreationDate(new Date(Date.UTC(2026, 8, 15)));
  pdf.setFileId('D0C7ACE0D0C7ACE0D0C7ACE0D0C7ACE0');
  const pages: ParsedDocument['pages'] = [];

  doc.pages.forEach((rows, pi) => {
    if (pi > 0) pdf.addPage();
    const lines: ParsedLine[] = [];
    let y = TOP;
    let lineNo = 0;

    const footerRows = rows.filter((r) => r.kind === 'text' && r.style === 'footer');
    const bodyRows = rows.filter((r) => !footerRows.includes(r));

    const place = (row: Row, baselineOverride?: number) => {
      const st = STYLE[row.style ?? 'body'];
      pdf.setFont(st.font, 'normal');
      pdf.setFontSize(st.size);
      pdf.setTextColor(...st.color);
      y += row.gap ?? 0;
      const baseline = baselineOverride ?? y + st.size * 0.8;
      const top = baseline - st.size * 0.82;
      const h = st.size * 1.08;

      if (row.kind === 'cols' && row.ruleAbove) {
        pdf.setDrawColor(200, 204, 214);
        pdf.setLineWidth(0.6);
        pdf.line(MARGIN, top - 4, PAGE_W - MARGIN, top - 4);
      }

      const cells = row.kind === 'cols' ? [...row.cells].sort((a, b) => a.x - b.x) : [{ text: row.text, x: 0, align: 'left' as const }];
      const placed = cells.map((c) => {
        const w = pdf.getTextWidth(c.text);
        return { ...c, w, x: MARGIN + (c.align === 'right' ? c.x - w : c.x) };
      });
      const minX = Math.min(...placed.map((c) => c.x));
      const maxX = Math.max(...placed.map((c) => c.x + c.w));

      if (row.kind === 'text' && row.box) {
        pdf.setDrawColor(230, 190, 40);
        pdf.setFillColor(255, 246, 204);
        pdf.roundedRect(minX - 6, top - 4, maxX - minX + 12, h + 8, 3, 3, 'FD');
      }

      let text = '';
      const spans: Span[] = [];
      for (const c of placed) {
        pdf.text(c.text, c.x, baseline);
        if (text) text += COLUMN_GAP;
        // One span per word, measured with the real font, so highlights hug the words exactly.
        for (const m of c.text.matchAll(/\S+/g)) {
          const before = pdf.getTextWidth(c.text.slice(0, m.index));
          spans.push({ start: text.length + m.index!, end: text.length + m.index! + m[0].length, x: (c.x + before) / PAGE_W, w: pdf.getTextWidth(m[0]) / PAGE_W });
        }
        text += c.text;
      }
      if (row.kind === 'cols' && row.ruleBelow) {
        pdf.setDrawColor(200, 204, 214);
        pdf.line(MARGIN, top + h + 3, PAGE_W - MARGIN, top + h + 3);
      }

      lineNo += 1;
      lines.push({
        id: `p${pi + 1}-L${lineNo}`,
        page: pi + 1,
        line: lineNo,
        text,
        bbox: { x: minX / PAGE_W, y: top / PAGE_H, w: (maxX - minX) / PAGE_W, h: h / PAGE_H },
        spans,
      });
      if (baselineOverride == null) y += st.size * 1.5;
    };

    for (const row of bodyRows) place(row);
    for (const row of footerRows) place(row, PAGE_H - 36);

    pages.push({ number: pi + 1, width: PAGE_W, height: PAGE_H, lines });
  });

  const bytes = new Uint8Array(pdf.output('arraybuffer'));
  return { bytes, parsed: { pages, source: 'pdf-text' } };
}
