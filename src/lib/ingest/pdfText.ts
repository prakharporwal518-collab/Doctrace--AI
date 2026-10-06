// Group pdf.js text items into reading-order lines with bounding boxes and
// per-item character spans. Pure, so it is unit-tested with real PDFs.

import type { ParsedLine, Span } from '../types';

export const COLUMN_GAP = '    ';

export interface RawItem {
  str: string;
  /** Top-left corner and size in viewport units (y grows downwards). */
  x: number;
  y: number; // baseline, from the top
  w: number;
  h: number; // font size
}

export function groupLines(items: RawItem[], pageNumber: number, pageW: number, pageH: number): ParsedLine[] {
  const cleaned = items.filter((it) => it.str && it.str.trim()).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Array<{ y: number; h: number; items: RawItem[] }> = [];
  for (const it of cleaned) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(2, Math.min(r.h, it.h) * 0.45));
    if (row) row.items.push(it);
    else rows.push({ y: it.y, h: it.h, items: [it] });
  }
  rows.sort((a, b) => a.y - b.y);

  return rows.map((r, i) => {
    const parts = r.items.sort((a, b) => a.x - b.x);
    let text = '';
    const spans: Span[] = [];
    let lastEnd: number | null = null;
    for (const p of parts) {
      const s = p.str.replace(/\s+$/, '');
      if (lastEnd !== null) {
        const gap = p.x - lastEnd;
        const charW = p.w / Math.max(1, p.str.length);
        if (gap > charW * 2.2) text = text.replace(/\s+$/, '') + COLUMN_GAP;
        else if (gap > charW * 0.15 && !text.endsWith(' ') && !s.startsWith(' ')) text += ' ';
      }
      const start = text.length;
      text += s;
      spans.push({ start, end: text.length, x: p.x / pageW, w: p.w / pageW });
      lastEnd = p.x + p.w;
    }
    const minX = Math.min(...parts.map((p) => p.x));
    const maxX = Math.max(...parts.map((p) => p.x + p.w));
    const size = Math.max(...parts.map((p) => p.h));
    const top = r.y - size * 0.82;
    return {
      id: `p${pageNumber}-L${i + 1}`,
      page: pageNumber,
      line: i + 1,
      text: text.trim(),
      bbox: { x: minX / pageW, y: top / pageH, w: (maxX - minX) / pageW, h: (size * 1.08) / pageH },
      spans,
    };
  });
}

/** Minimal shape of the pdf.js objects we touch, so this file needs no pdf.js types. */
export interface PdfJsPage {
  getViewport(o: { scale: number }): { width: number; height: number; convertToViewportPoint(x: number, y: number): number[] };
  getTextContent(): Promise<{ items: unknown[] }>;
}

export async function pageToLines(page: PdfJsPage, pageNumber: number): Promise<{ width: number; height: number; lines: ParsedLine[] }> {
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items: RawItem[] = [];
  for (const raw of content.items) {
    const it = raw as { str?: string; transform?: number[]; width?: number; height?: number };
    if (typeof it.str !== 'string' || !Array.isArray(it.transform)) continue;
    const [, , , d, e, f] = it.transform;
    const [x, y] = vp.convertToViewportPoint(e, f);
    const size = Math.abs(it.height || d || 10);
    items.push({ str: it.str, x, y, w: it.width ?? it.str.length * size * 0.5, h: size });
  }
  return { width: vp.width, height: vp.height, lines: groupLines(items, pageNumber, vp.width, vp.height) };
}
