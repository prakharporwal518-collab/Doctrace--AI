import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/app/auth';
import { useData } from '@/app/data';
import { t } from '@/app/i18n';
import { useToast } from '@/app/toast';
import { useAsync } from '@/app/useAsync';
import { radarItems, RadarList } from '@/components/RadarList';
import { Button, cx, ErrorState, PageHeader, Skeleton } from '@/components/ui';
import { toISO, todayUTC } from '@/lib/engine/dates';
import { buildICS } from '@/lib/engine/ics';
import { downloadBlob } from '@/lib/report';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function Radar() {
  const { repo, profile } = useSession();
  const { version } = useData();
  const toast = useToast();
  const today = todayUTC();
  const [month, setMonth] = useState(() => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
  const { data, error, loading, reload } = useAsync(async () => {
    const [obligations, docs] = await Promise.all([repo.listObligations(), repo.listDocuments()]);
    return { obligations, docs };
  }, [repo, version]);

  const items = useMemo(() => (data ? radarItems(data.obligations, data.docs) : []), [data]);

  // Expand recurring obligations into this month so the calendar shows every occurrence.
  const byDay = useMemo(() => {
    const map = new Map<string, typeof items>();
    const start = toISO(month)!;
    const end = toISO(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)))!;
    for (const it of items) {
      const dates = [it.due];
      if (it.o.recurrence && it.status !== 'done') {
        const step = it.o.recurrence === 'monthly' ? 1 : it.o.recurrence === 'quarterly' ? 3 : 12;
        let d = new Date(`${it.due}T00:00:00Z`);
        for (let i = 0; i < 36; i += 1) {
          d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + step, d.getUTCDate()));
          dates.push(toISO(d)!);
        }
      }
      for (const day of dates) if (day >= start && day <= end) map.set(day, [...(map.get(day) ?? []), it]);
    }
    return map;
  }, [items, month]);

  const cells = useMemo(() => {
    const first = (month.getUTCDay() + 6) % 7; // Monday first
    const days = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
    return [...Array.from({ length: first }, () => null), ...Array.from({ length: days }, (_, i) => new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), i + 1)))];
  }, [month]);

  const exportAll = async () => {
    const events = items.filter((i) => i.status !== 'done').map((i) => ({
      uid: i.o.id,
      date: i.due,
      title: `${i.o.party}: ${i.o.action}`.slice(0, 140),
      description: `${i.doc?.file_name ?? ''} p.${i.o.page} · L${i.o.line}\n“${i.o.source_text ?? ''}”${i.o.penalty_text ? `\nPenalty: ${i.o.penalty_text}` : ''}`,
      recurrence: i.o.recurrence,
    }));
    if (!events.length) {
      toast.info('Nothing to export', 'There are no open, dated obligations.');
      return;
    }
    downloadBlob(new Blob([buildICS(events)], { type: 'text/calendar' }), 'doctrace-deadlines.ics');
    await repo.log('export', { format: 'ics', events: events.length });
    toast.success(`${events.length} deadlines exported`, 'Import the .ics file in Google Calendar (Settings → Import & export).');
  };

  const todayIso = toISO(today);
  const monthLabel = month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div>
      <PageHeader
        title={t('radar', profile.language)}
        subtitle="Every obligation across every document. Overdue in red."
        actions={
          <Button variant="primary" onClick={() => void exportAll()}>
            <CalendarPlus className="size-4" /> Export to Google Calendar (.ics)
          </Button>
        }
      />
      {error && <ErrorState error={error} onRetry={reload} />}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">{monthLabel}</h2>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1)))} aria-label="Previous month">
                <ChevronLeft className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMonth(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)))}>
                Today
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)))} aria-label="Next month">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
          {loading && !data ? (
            <Skeleton className="h-96" />
          ) : (
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-line">
              {WEEKDAYS.map((w) => (
                <div key={w} className="bg-navy-2 py-1.5 text-center text-[11px] text-faint uppercase">
                  {w}
                </div>
              ))}
              {cells.map((d, i) => {
                if (!d) return <div key={`e${i}`} className="min-h-20 bg-navy-2/50" />;
                const iso = toISO(d)!;
                const list = byDay.get(iso) ?? [];
                return (
                  <div key={iso} className={cx('min-h-20 bg-card p-1 sm:min-h-24 sm:p-1.5', iso === todayIso && 'ring-1 ring-yellow ring-inset')}>
                    <p className={cx('text-xs', iso === todayIso ? 'font-semibold text-yellow' : 'text-faint')}>{d.getUTCDate()}</p>
                    <div className="mt-1 space-y-1">
                      {list.slice(0, 3).map((it) => {
                        const overdue = it.status === 'overdue' && iso === it.due;
                        return (
                          <Link
                            key={it.o.id + iso}
                            to={`/documents/${it.o.document_id}?find=ob:${it.o.id}&tab=obligations`}
                            title={`${it.o.party}: ${it.o.action}`}
                            className={cx('block truncate rounded px-1 py-0.5 text-[10px] leading-tight sm:text-[11px]', it.status === 'done' ? 'bg-amount/15 text-amount line-through' : overdue ? 'bg-anomaly/20 text-[#ff8a95]' : 'bg-deadline/20 text-[#c3bfff]')}
                          >
                            {it.o.party.split(' ')[0]}: {it.o.action}
                          </Link>
                        );
                      })}
                      {list.length > 3 && <p className="text-[10px] text-faint">+{list.length - 3} more</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        <section className="card h-fit p-4">
          <h2 className="mb-3 font-semibold">Timeline</h2>
          {data ? <RadarList obligations={data.obligations} docs={data.docs} /> : <Skeleton className="h-64" />}
        </section>
      </div>
    </div>
  );
}
