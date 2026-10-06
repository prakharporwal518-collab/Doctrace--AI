// The Deadline Radar list: overdue first, then the next 7 days, then later.
import { Repeat } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { DocumentSummary } from '@/lib/data/repo';
import { daysBetween, formatDate, fromISO, todayUTC } from '@/lib/engine/dates';
import { effectiveDueDate, effectiveStatus, inNextDays } from '@/lib/engine/obligations';
import type { Obligation } from '@/lib/types';
import { cx } from './ui';

export interface RadarItem {
  o: Obligation;
  due: string;
  status: Obligation['status'];
  doc?: DocumentSummary;
}

export function radarItems(obligations: Obligation[], docs: DocumentSummary[]): RadarItem[] {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const out: RadarItem[] = [];
  for (const o of obligations) {
    const due = effectiveDueDate(o);
    if (due) out.push({ o, due, status: effectiveStatus(o), doc: byId.get(o.document_id) });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

function relative(due: string): string {
  const d = daysBetween(todayUTC(), fromISO(due)!);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d < 0) return `${-d} day${d === -1 ? '' : 's'} overdue`;
  return `in ${d} days`;
}

export function RadarList({ obligations, docs, compact }: { obligations: Obligation[]; docs: DocumentSummary[]; compact?: boolean }) {
  const items = radarItems(obligations, docs).filter((i) => i.status !== 'done');
  const overdue = items.filter((i) => i.status === 'overdue');
  const week = items.filter((i) => i.status !== 'overdue' && inNextDays(i.due, 7));
  const later = items.filter((i) => i.status !== 'overdue' && !inNextDays(i.due, 7));
  if (!items.length) return <p className="py-6 text-center text-sm text-muted">No dated obligations. Upload a contract or invoice to fill the radar.</p>;

  const group = (title: string, list: RadarItem[], tone: string) =>
    list.length > 0 && (
      <div>
        <p className={cx('label mb-1.5', tone)}>
          {title} · {list.length}
        </p>
        <ul className="space-y-1.5">
          {(compact ? list.slice(0, 4) : list).map((i) => (
            <li key={i.o.id}>
              <Link to={`/documents/${i.o.document_id}?find=ob:${i.o.id}&tab=obligations`} className="flex gap-3 rounded-lg border border-line p-2.5 transition-colors hover:border-line-2 hover:bg-white/[0.02]">
                <div className={cx('w-12 shrink-0 text-center', i.status === 'overdue' ? 'text-anomaly' : 'text-deadline')}>
                  <p className="text-lg leading-none font-semibold">{fromISO(i.due)!.getUTCDate()}</p>
                  <p className="text-[11px] uppercase">{formatDate(i.due).split(' ')[1]}</p>
                </div>
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm">
                    <span className="font-medium text-[#86c3ff]">{i.o.party}</span>: {i.o.action}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-faint">
                    <span className={i.status === 'overdue' ? 'text-anomaly' : ''}>{relative(i.due)}</span>
                    {i.o.recurrence && (
                      <span className="flex items-center gap-1">
                        <Repeat className="size-3" />
                        {i.o.recurrence}
                      </span>
                    )}
                    {i.doc && <span className="truncate">· {i.doc.file_name}</span>}
                    <span className="cite text-yellow/80">
                      ↳ p.{i.o.page} · L{i.o.line}
                    </span>
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="space-y-4">
      {group('Overdue', overdue, 'text-anomaly')}
      {group('Next 7 days', week, 'text-yellow')}
      {!compact || (!overdue.length && !week.length) ? group('Later', later, '') : later.length > 0 && <p className="text-xs text-faint">+ {later.length} later deadline{later.length === 1 ? '' : 's'}</p>}
    </div>
  );
}
