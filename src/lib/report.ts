// Evidence Pack: a PDF audit report with every finding, its citation and a
// cropped screenshot of the highlighted source line.

import { RULES } from './engine/anomalies';
import { formatDate } from './engine/dates';
import { effectiveDueDate, effectiveStatus } from './engine/obligations';
import { trustScore } from './engine/trust';
import { loadPdfJs } from './ingest';
import { createPdfWithFonts } from './pdfgen/generate';
import type { BBox, Correction, DocumentBundle } from './types';

const W = 595.28;
const H = 841.89;
const M = 48;
const INK: [number, number, number] = [22, 27, 40];
const MUTED: [number, number, number] = [96, 104, 124];

const COLOR: Record<string, [number, number, number]> = {
  anomaly: [255, 93, 108],
  deadline: [143, 136, 255],
  date: [143, 136, 255],
  amount: [62, 207, 142],
  line_item: [62, 207, 142],
  obligation: [78, 168, 255],
  party: [150, 160, 185],
  identifier: [150, 160, 185],
};

type Cropper = (page: number, bbox: BBox | null, color: [number, number, number]) => Promise<{ data: string; w: number; h: number } | null>;

/** Renders pages once and cuts out the strip around a bounding box. */
async function makeCropper(bundle: DocumentBundle, file: Blob): Promise<{ crop: Cropper; dispose: () => void }> {
  const kind = bundle.document.mime_type === 'application/pdf' ? 'pdf' : bundle.document.mime_type.startsWith('image/') ? 'image' : 'text';
  if (kind === 'text') return { crop: async () => null, dispose: () => {} };
  const pages = new Map<number, HTMLCanvasElement>();

  let pdf: Awaited<ReturnType<Awaited<ReturnType<typeof loadPdfJs>>['getDocument']>['promise']> | null = null;
  let task: { destroy(): Promise<void> } | null = null;
  let image: ImageBitmap | null = null;
  if (kind === 'pdf') {
    const lib = await loadPdfJs();
    const t = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    task = t;
    pdf = await t.promise;
  } else image = await createImageBitmap(file);

  const pageCanvas = async (n: number) => {
    if (pages.has(n)) return pages.get(n)!;
    const c = document.createElement('canvas');
    if (pdf) {
      const p = await pdf.getPage(n);
      const vp = p.getViewport({ scale: 2 });
      c.width = Math.ceil(vp.width);
      c.height = Math.ceil(vp.height);
      await p.render({ canvas: c, viewport: vp }).promise;
    } else if (image) {
      c.width = image.width;
      c.height = image.height;
      c.getContext('2d')!.drawImage(image, 0, 0);
    }
    pages.set(n, c);
    return c;
  };

  const dispose = () => {
    void task?.destroy().catch(() => {});
    image?.close();
    pages.clear();
  };

  const crop: Cropper = async (page, bbox, color) => {
    if (!bbox) return null;
    try {
      const src = await pageCanvas(page);
      // A strip: full text width, a little context above and below.
      const x0 = Math.max(0, (Math.min(bbox.x, 0.08) - 0.01) * src.width);
      const x1 = Math.min(src.width, Math.max(bbox.x + bbox.w, 0.92) * src.width + 0.01 * src.width);
      const y0 = Math.max(0, (bbox.y - bbox.h * 1.2) * src.height);
      const y1 = Math.min(src.height, (bbox.y + bbox.h * 2.2) * src.height);
      const out = document.createElement('canvas');
      out.width = Math.round(x1 - x0);
      out.height = Math.round(y1 - y0);
      const ctx = out.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
      ctx.strokeStyle = `rgb(${color.join(',')})`;
      ctx.lineWidth = 3;
      ctx.fillStyle = `rgba(${color.join(',')},0.16)`;
      const rx = bbox.x * src.width - x0 - 4;
      const ry = bbox.y * src.height - y0 - 3;
      ctx.fillRect(rx, ry, bbox.w * src.width + 8, bbox.h * src.height + 6);
      ctx.strokeRect(rx, ry, bbox.w * src.width + 8, bbox.h * src.height + 6);
      return { data: out.toDataURL('image/jpeg', 0.85), w: out.width, h: out.height };
    } catch {
      return null;
    }
  };
  return { crop, dispose };
}

export async function buildEvidencePack(bundle: DocumentBundle, file: Blob, corrections: Correction[] = []): Promise<Blob> {
  const pdf = await createPdfWithFonts();
  const { crop, dispose } = await makeCropper(bundle, file);
  try {
    return await render();
  } finally {
    dispose();
  }

  async function render(): Promise<Blob> {
  const d = bundle.document;
  let y = M;

  const font = (bold = false, size = 10, color = INK) => {
    pdf.setFont(bold ? 'sansBold' : 'sans', 'normal');
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
  };
  const ensure = (h: number) => {
    if (y + h > H - M) {
      pdf.addPage();
      y = M;
    }
  };
  const para = (text: string, size = 10, color = INK, bold = false, indent = 0) => {
    font(bold, size, color);
    const lines = pdf.splitTextToSize(text, W - M * 2 - indent) as string[];
    for (const l of lines) {
      ensure(size * 1.45);
      pdf.text(l, M + indent, y + size);
      y += size * 1.45;
    }
  };
  const heading = (text: string) => {
    ensure(40);
    y += 14;
    font(true, 13);
    pdf.text(text, M, y + 13);
    y += 22;
    pdf.setDrawColor(220, 224, 232);
    pdf.line(M, y, W - M, y);
    y += 8;
  };
  const shot = async (page: number | null, bbox: BBox | null, color: [number, number, number]) => {
    if (!page) return;
    const img = await crop(page, bbox, color);
    if (!img) return;
    const w = W - M * 2;
    const h = Math.min(90, (img.h / img.w) * w);
    ensure(h + 8);
    pdf.addImage(img.data, 'JPEG', M, y, w, h);
    pdf.setDrawColor(210, 214, 224);
    pdf.rect(M, y, w, h);
    y += h + 8;
  };
  const cite = (page: number | null, line: number | null) => (page ? `↳ p.${page}${line ? ` · L${line}` : ''}` : '↳ schema');

  // ---- Cover ----
  font(true, 22);
  pdf.text('Evidence Pack', M, y + 22);
  y += 34;
  para('DocTrace AI · No source, no output.', 10, MUTED);
  y += 10;
  const trust = trustScore({ anomalies: bundle.anomalies, missing: bundle.missing, confidences: bundle.extractions.map((e) => e.confidence) });
  const rows: Array<[string, string]> = [
    ['Document', d.file_name],
    ['Type', d.doc_type.replace('_', ' ')],
    ['Pages', String(d.page_count)],
    ['Uploaded', new Date(d.uploaded_at).toLocaleString('en-IN')],
    ['SHA-256', d.sha256_hash],
    ['Trust score', `${d.trust_score ?? '–'} / 100  (${trust.parts.map((p) => `${p.label} ${p.points}`).join(', ') || 'no deductions'})`],
    ['Completeness', d.completeness == null ? '–' : `${d.completeness} / 100`],
    ['Evidence Lock', `${d.fields_extracted} fields extracted, ${d.fields_discarded} discarded for missing evidence`],
    ['Generated', new Date().toLocaleString('en-IN')],
  ];
  for (const [k, v] of rows) {
    font(true, 9, MUTED);
    ensure(14);
    pdf.text(k.toUpperCase(), M, y + 9);
    font(false, 10);
    const lines = pdf.splitTextToSize(v, W - M * 2 - 110) as string[];
    lines.forEach((l, i) => pdf.text(l, M + 110, y + 10 + i * 13));
    y += Math.max(16, lines.length * 13 + 3);
  }
  if (d.tamper_warning) {
    y += 6;
    para(`Tamper warning: ${d.tamper_warning}`, 10, [200, 110, 0], true);
  }

  // ---- Anomalies ----
  heading(`Anomalies (${bundle.anomalies.length})`);
  if (!bundle.anomalies.length) para('No anomalies were detected by the deterministic rules.', 10, MUTED);
  const sev = { high: 0, medium: 1, low: 2 } as const;
  for (const a of [...bundle.anomalies].sort((x, z) => sev[x.severity] - sev[z.severity])) {
    ensure(60);
    para(`${a.severity.toUpperCase()} · ${a.title}`, 11, INK, true);
    para(`${cite(a.page, a.line)}   Rule: ${RULES[a.rule_code]?.name ?? a.rule_code}`, 9, MUTED);
    if (a.expected_value || a.found_value) para(`Expected: ${a.expected_value ?? '—'}    Found: ${a.found_value ?? '—'}`, 10);
    para(a.explanation, 9, MUTED);
    await shot(a.page, a.bbox, COLOR.anomaly);
    y += 4;
  }

  // ---- Missing ----
  heading(`Missing data (${bundle.missing.length})`);
  if (!bundle.missing.length) para('Every required field for this document type is present.', 10, MUTED);
  for (const m of bundle.missing) {
    para(`${m.severity.toUpperCase()} · ${m.field_name}`, 10, INK, true);
    para(m.why_required, 9, MUTED, false, 12);
  }

  // ---- Extractions ----
  const fields = bundle.extractions.filter((e) => e.reviewer_status !== 'rejected');
  heading(`Extracted fields (${fields.length})`);
  const order = ['deadline', 'amount', 'obligation', 'party', 'date', 'identifier', 'line_item'];
  for (const e of [...fields].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.page - b.page || a.line - b.line)) {
    ensure(50);
    para(`${e.label}: ${e.value}`, 10, INK, true);
    para(`${cite(e.page, e.line)} · confidence ${Math.round(e.confidence * 100)}% · ${e.source} · review: ${e.reviewer_status}`, 8.5, MUTED);
    para(`“${e.raw_text}”`, 9, MUTED, false, 10);
    if (['deadline', 'amount', 'obligation'].includes(e.category)) await shot(e.page, e.bbox, COLOR[e.category] ?? COLOR.party);
  }

  // ---- Obligations ----
  heading(`Obligations (${bundle.obligations.length})`);
  for (const o of bundle.obligations) {
    const due = effectiveDueDate(o);
    para(`${o.party}: ${o.action}`, 10, INK, true);
    para(`${due ? `Due ${formatDate(due)}` : 'No fixed date'}${o.recurrence ? ` (repeats ${o.recurrence})` : ''} · ${effectiveStatus(o)} · ${cite(o.page, o.line)}`, 9, MUTED, false, 12);
    if (o.penalty_text) para(`Penalty: ${o.penalty_text}`, 9, MUTED, false, 12);
  }

  // ---- Review history ----
  if (corrections.length) {
    heading('Review history');
    for (const c of corrections) para(`${new Date(c.created_at).toLocaleString('en-IN')}: “${c.old_value}” → “${c.new_value}”`, 9);
  }

  // Footer on every page
  const n = pdf.getNumberOfPages();
  for (let i = 1; i <= n; i += 1) {
    pdf.setPage(i);
    font(false, 8, MUTED);
    pdf.text(`DocTrace AI Evidence Pack · ${d.file_name} · page ${i} of ${n}`, M, H - 24);
  }
  return pdf.output('blob');
  }
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
