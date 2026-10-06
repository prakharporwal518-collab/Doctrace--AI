// The left half of the split screen: the original document with coloured
// highlight boxes. Clicking a box selects its card; selecting a card scrolls
// here and pulses the exact line.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { loadPdfJs } from '@/lib/ingest';
import type { BBox, DocumentRow, ParsedPage } from '@/lib/types';
import { cx, ErrorState, Skeleton } from './ui';

export interface Highlight {
  id: string;
  page: number;
  line: number;
  bbox: BBox | null;
  color: string;
  label: string;
}

interface Props {
  doc: Pick<DocumentRow, 'id' | 'mime_type' | 'file_name'> & { pages: ParsedPage[] | null };
  loadFile: () => Promise<Blob>;
  highlights: Highlight[];
  activeId: string | null;
  /** Changes every time the same highlight is selected again, to replay the pulse. */
  pulseKey: number;
  onSelect: (id: string) => void;
}

type PdfDoc = Awaited<ReturnType<Awaited<ReturnType<typeof loadPdfJs>>['getDocument']>['promise']>;

export function DocumentViewer({ doc, loadFile, highlights, activeId, pulseKey, onSelect }: Props) {
  const kind = doc.mime_type === 'application/pdf' ? 'pdf' : doc.mime_type.startsWith('image/') ? 'image' : 'text';
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // Track the available width so pages re-render crisply on resize.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(Math.min(900, Math.floor(e.contentRect.width) - 2)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load the original file.
  useEffect(() => {
    if (kind === 'text') return undefined;
    let cancelled = false;
    let url: string | null = null;
    let task: { destroy(): Promise<void> } | null = null;
    (async () => {
      try {
        const blob = await loadFile();
        if (cancelled) return;
        if (kind === 'image') {
          url = URL.createObjectURL(blob);
          setImageUrl(url);
        } else {
          const lib = await loadPdfJs();
          const t = lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
          task = t;
          const loaded = await t.promise;
          if (!cancelled) setPdf(loaded);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      // pdf.js v6: the loading task owns the document and its worker.
      if (task) void task.destroy().catch(() => {});
      setPdf(null);
      setImageUrl(null);
    };
  }, [doc.id, kind, loadFile, attempt]);

  // Bring the active highlight into view.
  useEffect(() => {
    if (!activeId || !scroller.current) return;
    const el = scroller.current.querySelector<HTMLElement>(`[data-hl="${CSS.escape(activeId)}"]`);
    if (el) {
      const box = scroller.current;
      const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - box.clientHeight / 3;
      box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }, [activeId, pulseKey, pdf, imageUrl, width]);

  const byPage = useMemo(() => {
    const m = new Map<number, Highlight[]>();
    for (const h of highlights) m.set(h.page, [...(m.get(h.page) ?? []), h]);
    return m;
  }, [highlights]);

  const pages = doc.pages ?? [];

  return (
    <div ref={scroller} className="h-full overflow-y-auto rounded-[10px] border border-line bg-[#0b1122] p-3 sm:p-4" aria-label={`Document: ${doc.file_name}`}>
      {error && <ErrorState title="Could not open the original file" error={error} onRetry={() => {
            setError(null);
            setAttempt((a) => a + 1);
          }} />}
      {!error && kind === 'pdf' && !pdf && <PageSkeleton />}
      {!error && kind === 'pdf' && pdf && width > 0 && (
        <div className="space-y-4">
          {pages.map((p) => (
            <PdfPage key={p.number} pdf={pdf} page={p} width={width} highlights={byPage.get(p.number) ?? []} activeId={activeId} pulseKey={pulseKey} onSelect={onSelect} />
          ))}
        </div>
      )}
      {!error && kind === 'image' && !imageUrl && <PageSkeleton />}
      {!error && kind === 'image' && imageUrl && (
        <div className="relative mx-auto bg-white" style={{ maxWidth: width || undefined }}>
          <img src={imageUrl} alt={doc.file_name} className="block w-full" />
          <Boxes highlights={byPage.get(1) ?? []} activeId={activeId} pulseKey={pulseKey} onSelect={onSelect} />
        </div>
      )}
      {kind === 'text' && (
        <div className="space-y-4">
          {pages.map((p) => (
            <TextPage key={p.number} page={p} highlights={byPage.get(p.number) ?? []} activeId={activeId} pulseKey={pulseKey} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-[900px] space-y-3 bg-white/[0.03] p-8" role="status" aria-label="Loading document">
      <Skeleton className="h-6 w-1/3" />
      {Array.from({ length: 10 }, (_, i) => (
        <Skeleton key={i} className="h-3" />
      ))}
    </div>
  );
}

function PdfPage({ pdf, page, width, highlights, activeId, pulseKey, onSelect }: { pdf: PdfDoc; page: ParsedPage; width: number; highlights: Highlight[]; activeId: string | null; pulseKey: number; onSelect: (id: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(page.number <= 2);
  const [failed, setFailed] = useState(false);
  const height = Math.round((width * page.height) / page.width);

  // Render lazily: only pages near the viewport.
  useEffect(() => {
    const el = wrap.current;
    if (!el || visible) return undefined;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  // A selected highlight on a far page must render that page too.
  const show = visible || highlights.some((h) => h.id === activeId);

  useEffect(() => {
    if (!show || !canvas.current) return undefined;
    let task: { cancel(): void; promise: Promise<unknown> } | null = null;
    let cancelled = false;
    (async () => {
      try {
        const p = await pdf.getPage(page.number);
        if (cancelled) return;
        const base = p.getViewport({ scale: 1 });
        const dpr = Math.min(2.5, window.devicePixelRatio || 1);
        const viewport = p.getViewport({ scale: (width / base.width) * dpr });
        const c = canvas.current!;
        c.width = Math.floor(viewport.width);
        c.height = Math.floor(viewport.height);
        task = p.render({ canvas: c, viewport });
        await task.promise;
      } catch (err) {
        if ((err as { name?: string })?.name !== 'RenderingCancelledException' && !cancelled) {
          console.error(`pdf.js could not render page ${page.number}`, err);
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page.number, width, show]);

  return (
    <div ref={wrap} className="relative mx-auto bg-white shadow-lg shadow-black/40" style={{ width, height }} data-page={page.number}>
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-label={`Page ${page.number}`} />
      {failed && <p className="absolute inset-0 grid place-items-center text-sm text-navy">This page could not be drawn.</p>}
      <Boxes highlights={highlights} activeId={activeId} pulseKey={pulseKey} onSelect={onSelect} />
      <span className="absolute -top-0 right-1 rounded-b bg-navy/80 px-1.5 py-0.5 font-mono text-[10px] text-muted">p.{page.number}</span>
    </div>
  );
}

function Boxes({ highlights, activeId, pulseKey, onSelect }: { highlights: Highlight[]; activeId: string | null; pulseKey: number; onSelect: (id: string) => void }) {
  return (
    <>
      {highlights
        .filter((h) => h.bbox)
        .map((h) => {
          const b = h.bbox!;
          const active = h.id === activeId;
          const pad = 0.003;
          return (
            <button
              key={active ? `${h.id}-${pulseKey}` : h.id}
              type="button"
              data-hl={h.id}
              onClick={() => onSelect(h.id)}
              title={h.label}
              aria-label={`${h.label} (line ${h.line})`}
              className={cx('absolute rounded-[3px] transition-[background,border-color] duration-150', active ? 'z-10 animate-pulse-box border-2' : 'border hover:border-2')}
              style={
                {
                  left: `${(b.x - pad) * 100}%`,
                  top: `${(b.y - pad) * 100}%`,
                  width: `${(b.w + pad * 2) * 100}%`,
                  height: `${(b.h + pad * 2) * 100}%`,
                  borderColor: h.color,
                  background: `color-mix(in srgb, ${h.color} ${active ? 30 : 12}%, transparent)`,
                  '--hl': h.color,
                } as CSSProperties
              }
            />
          );
        })}
    </>
  );
}

/** DOCX (no layout): show numbered lines; highlights mark whole lines. */
function TextPage({ page, highlights, activeId, pulseKey, onSelect }: { page: ParsedPage; highlights: Highlight[]; activeId: string | null; pulseKey: number; onSelect: (id: string) => void }) {
  return (
    <div className="mx-auto max-w-[900px] bg-white px-4 py-6 font-serif text-[13px] leading-6 text-[#1b2030] shadow-lg shadow-black/40 sm:px-10">
      <p className="mb-3 text-right font-mono text-[10px] text-[#8a90a0]">page {page.number}</p>
      {page.lines.map((l) => {
        const hs = highlights.filter((h) => h.line === l.line);
        const active = hs.find((h) => h.id === activeId);
        const h = active ?? hs[0];
        return (
          <div key={l.id} className="flex gap-3">
            <span className="w-7 shrink-0 text-right font-mono text-[10px] leading-6 text-[#9aa0ad] select-none">{l.line}</span>
            {h ? (
              <button
                key={active ? `${h.id}-${pulseKey}` : h.id}
                type="button"
                data-hl={h.id}
                onClick={() => onSelect(h.id)}
                className={cx('-mx-1 flex-1 rounded px-1 text-left', active && 'animate-pulse-box')}
                style={{ background: `color-mix(in srgb, ${h.color} ${active ? 32 : 14}%, transparent)`, '--hl': h.color } as CSSProperties}
              >
                {l.text}
              </button>
            ) : (
              <span className="flex-1">{l.text}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
