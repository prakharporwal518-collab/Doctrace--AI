import { useEffect, useRef } from 'react';
import { citationLabel } from '../../lib/citation.js';

function highlight(text, quote) {
  if (!quote) return text;
  const q = quote.replace(/…$/, '');
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0 || !q) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

export default function DocumentViewer({ doc, page, onPage, active }) {
  const scrollRef = useRef(null);
  const activeLineId = active && active.source?.docId === doc?.id ? active.source.lineId : null;
  const relatedIds = new Set(
    (active?.related || []).filter((r) => r.docId === doc?.id).map((r) => r.lineId),
  );

  // Scroll the cited line into view inside the viewer only (not the page).
  useEffect(() => {
    if (!activeLineId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-line="${activeLineId}"]`);
    if (!el) return;
    const box = scrollRef.current;
    const top = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
    box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [activeLineId, page]);

  if (!doc) return <div className="viewer viewer--empty muted">Select a document to view it.</div>;

  const current = doc.pages.find((p) => p.number === page) || doc.pages[0];
  const total = doc.pages.length;

  return (
    <div className="viewer">
      <div className="viewer__bar">
        <span className="mono small ellipsis" title={doc.name}>{doc.name} · page {current.number}</span>
        <div className="pager">
          <button type="button" className="btn btn--ghost btn--xs" disabled={current.number <= 1} onClick={() => onPage(current.number - 1)} aria-label="Previous page">‹</button>
          <span className="small">{current.number} / {total}</span>
          <button type="button" className="btn btn--ghost btn--xs" disabled={current.number >= total} onClick={() => onPage(current.number + 1)} aria-label="Next page">›</button>
        </div>
      </div>
      {active?.source?.schema && active.source.docId === doc.id && (
        <div className="viewer__note">
          <strong>{active.label}.</strong> Checked against the {active.source.schema} schema: this field was not found
          anywhere in the document, so there is no line to highlight.
        </div>
      )}
      {active && active.source?.docId === doc.id && !active.source.schema && active.source.page !== current.number && (
        <button type="button" className="viewer__note viewer__jump" onClick={() => onPage(active.source.page)}>
          The selected finding is on page {active.source.page}. Go there →
        </button>
      )}
      <div className="viewer__scroll" ref={scrollRef} tabIndex={0} aria-label={`Text of ${doc.name}, page ${current.number}`}>
        <ol className="lines">
          {current.lines.map((l) => {
            const isActive = l.id === activeLineId;
            const isRelated = relatedIds.has(l.id);
            return (
              <li key={l.id} data-line={l.id} className={`${isActive ? 'is-active' : ''} ${isRelated ? 'is-related' : ''}`}>
                <span className="lines__n" aria-hidden="true">{l.line}</span>
                <span className="lines__t">{isActive ? highlight(l.text, active.source.quote) : isRelated ? highlight(l.text, active.related.find((r) => r.lineId === l.id)?.quote) : l.text || ' '}</span>
                {isActive && <span className="lines__tag">↳ {citationLabel(active.source)}</span>}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
