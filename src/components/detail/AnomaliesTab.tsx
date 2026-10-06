import { ChevronDown, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RULES } from '@/lib/engine/anomalies';
import type { Anomaly } from '@/lib/types';
import { Cite, cx, EmptyState, SeverityBadge } from '../ui';
import { Quote } from './ExtractionsTab';

export function AnomaliesTab({ anomalies, activeId, onLocate }: { anomalies: Anomaly[]; activeId: string | null; onLocate: (id: string) => void }) {
  const sev = { high: 0, medium: 1, low: 2 } as const;
  if (!anomalies.length) return <EmptyState title="No anomalies" body="All deterministic checks passed: arithmetic, GST type, identifiers, dates and duplicates." />;
  return (
    <ul className="space-y-2.5">
      {[...anomalies].sort((a, b) => sev[a.severity] - sev[b.severity]).map((a) => (
        <AnomalyCard key={a.id} a={a} active={activeId === `an:${a.id}`} onLocate={onLocate} />
      ))}
    </ul>
  );
}

function AnomalyCard({ a, active, onLocate }: { a: Anomaly; active: boolean; onLocate: (id: string) => void }) {
  const [open, setOpen] = useState(active);
  const rule = RULES[a.rule_code];
  return (
    <li id={`card-an:${a.id}`} className={cx('card scroll-mt-24 overflow-hidden transition-colors', active && 'border-anomaly/60')}>
      <div className="flex items-start justify-between gap-3 p-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={a.severity} />
            <span className="font-mono text-[11px] text-faint">{a.rule_code}</span>
          </div>
          <p className="mt-1.5 font-semibold">{a.title}</p>
        </div>
        <Cite page={a.page} line={a.line} onClick={a.page ? () => onLocate(`an:${a.id}`) : undefined} />
      </div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between border-t border-line px-3.5 py-2 text-left text-sm text-muted hover:bg-white/[0.02] hover:text-ink">
        Why was this flagged?
        <ChevronDown className={cx('size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-line bg-navy-2/60 p-3.5 text-sm">
          <div>
            <p className="label mb-1">Rule · {rule?.name ?? a.rule_code}</p>
            <p className="text-muted">{a.explanation}</p>
          </div>
          {(a.expected_value || a.found_value) && (
            <dl className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-amount/30 bg-amount/5 p-2">
                <dt className="label">Expected</dt>
                <dd className="mt-0.5 font-medium text-amount">{a.expected_value ?? '—'}</dd>
              </div>
              <div className="rounded-md border border-anomaly/30 bg-anomaly/5 p-2">
                <dt className="label">Found</dt>
                <dd className="mt-0.5 font-medium text-[#ff8a95]">{a.found_value ?? '—'}</dd>
              </div>
            </dl>
          )}
          {a.source_text && (
            <div>
              <p className="label mb-1">Source line</p>
              <Quote text={a.source_text} mark={a.found_value ?? undefined} />
            </div>
          )}
          {a.related.length > 0 && (
            <div>
              <p className="label mb-1">Also checked</p>
              <ul className="space-y-1">
                {a.related.map((r, i) => (
                  <li key={i} className="flex items-start justify-between gap-3">
                    <span className="min-w-0 truncate font-serif text-[13px] text-muted">“{r.source_text}”</span>
                    {r.document_id ? (
                      <Link to={`/documents/${r.document_id}?line=${r.page}-${r.line}`} className="cite flex shrink-0 items-center gap-1 text-yellow hover:underline">
                        ↳ {r.file_name} · p.{r.page} · L{r.line} <ExternalLink className="size-3" />
                      </Link>
                    ) : (
                      <Cite page={r.page} line={r.line} onClick={() => onLocate(`rel:${a.id}:${i}`)} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
