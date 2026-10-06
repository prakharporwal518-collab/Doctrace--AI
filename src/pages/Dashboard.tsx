import { AlertTriangle, CalendarClock, FileStack, Gauge, ShieldCheck, Upload } from 'lucide-react';
import { lazy, Suspense, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/app/auth';
import { useData } from '@/app/data';
import { t } from '@/app/i18n';
import { useAsync } from '@/app/useAsync';
import { DocRow } from '@/components/DocRow';
import { RadarList } from '@/components/RadarList';
import { Button, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui';
import { RULES } from '@/lib/engine/anomalies';
import { effectiveDueDate, effectiveStatus, inNextDays } from '@/lib/engine/obligations';

const AnomalyChart = lazy(() => import('@/components/charts/AnomalyChart'));

export default function Dashboard() {
  const { repo, profile } = useSession();
  const { version, openUpload } = useData();
  const lang = profile.language;
  const { data, error, loading, reload } = useAsync(async () => {
    const [docs, anomalies, obligations] = await Promise.all([repo.listDocuments(), repo.listAnomalies(), repo.listObligations()]);
    return { docs, anomalies, obligations };
  }, [repo, version]);

  const stats = useMemo(() => {
    if (!data) return null;
    const ready = data.docs.filter((d) => d.status === 'ready');
    const scored = ready.filter((d) => d.trust_score != null);
    const upcoming = data.obligations.filter((o) => effectiveStatus(o) !== 'done' && inNextDays(effectiveDueDate(o), 30));
    const byRule = new Map<string, { count: number; high: boolean }>();
    for (const a of data.anomalies) {
      const name = RULES[a.rule_code]?.name ?? a.rule_code;
      const cur = byRule.get(name) ?? { count: 0, high: false };
      byRule.set(name, { count: cur.count + 1, high: cur.high || a.severity === 'high' });
    }
    return {
      processed: ready.length,
      anomalies: data.anomalies.length,
      upcoming: upcoming.length,
      overdue: data.obligations.filter((o) => effectiveStatus(o) === 'overdue').length,
      avgTrust: scored.length ? Math.round(scored.reduce((s, d) => s + (d.trust_score ?? 0), 0) / scored.length) : null,
      extracted: ready.reduce((s, d) => s + d.fields_extracted, 0),
      discarded: ready.reduce((s, d) => s + d.fields_discarded, 0),
      chart: [...byRule.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.count - a.count),
      anomaliesByDoc: new Map(ready.map((d) => [d.id, data.anomalies.filter((a) => a.document_id === d.id).length])),
    };
  }, [data]);

  const greeting = profile.full_name ? `${lang === 'hi' ? 'नमस्ते' : 'Hello'}, ${profile.full_name.split(' ')[0]}` : t('dashboard', lang);

  return (
    <div>
      <PageHeader
        title={greeting}
        subtitle={lang === 'hi' ? 'हर तथ्य, उसके स्रोत के साथ।' : 'Every deadline, amount and anomaly, with the line it came from.'}
        actions={
          <Button variant="primary" onClick={openUpload}>
            <Upload className="size-4" /> {t('upload', lang)}
          </Button>
        }
      />
      {error && <ErrorState error={error} onRetry={reload} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: t('docsProcessed', lang), value: stats?.processed, icon: <FileStack className="size-4" />, tone: 'text-ink' },
          { label: t('anomaliesFound', lang), value: stats?.anomalies, icon: <AlertTriangle className="size-4" />, tone: 'text-anomaly' },
          { label: t('upcomingDeadlines', lang), value: stats?.upcoming, icon: <CalendarClock className="size-4" />, tone: 'text-deadline', sub: stats?.overdue ? `${stats.overdue} overdue` : undefined },
          { label: t('avgTrust', lang), value: stats?.avgTrust ?? '–', icon: <Gauge className="size-4" />, tone: 'text-yellow' },
        ].map((s) => (
          <div key={s.label} className="card p-4">
            <p className="flex items-center gap-2 text-xs text-muted">
              {s.icon} {s.label}
            </p>
            {loading && !stats ? <Skeleton className="mt-2 h-8 w-16" /> : <p className={`mt-1.5 text-3xl font-semibold tabular-nums ${s.tone}`}>{s.value ?? 0}</p>}
            {s.sub && <p className="mt-0.5 text-xs text-anomaly">{s.sub}</p>}
          </div>
        ))}
      </div>

      {stats && stats.processed > 0 && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted">
          <ShieldCheck className="size-4 text-amount" /> Evidence Lock: <b className="text-ink tabular-nums">{stats.extracted}</b> fields extracted, <b className="text-ink tabular-nums">{stats.discarded}</b> discarded for missing evidence.
        </p>
      )}

      {data && !data.docs.length ? (
        <div className="mt-6">
          <EmptyState
            icon={<FileStack className="size-8" />}
            title="No documents yet"
            body="Upload an invoice, contract or purchase order, or try one of the built-in samples from the upload window."
            action={
              <Button variant="primary" onClick={openUpload}>
                <Upload className="size-4" /> Upload your first document
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            <section className="card p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold">Recent documents</h2>
                <Link to="/documents" className="text-sm text-yellow hover:underline">
                  View all
                </Link>
              </div>
              {loading && !data ? <Skeleton className="h-48" /> : <div className="-mx-2">{data?.docs.slice(0, 6).map((d) => <DocRow key={d.id} d={d} anomalies={stats?.anomaliesByDoc.get(d.id)} />)}</div>}
            </section>
            <section className="card p-4">
              <h2 className="mb-1 font-semibold">Anomalies by type</h2>
              <p className="mb-3 text-xs text-faint">Deterministic rules, so every bar is explainable. Red bars include at least one high-severity finding.</p>
              {stats?.chart.length ? (
                <Suspense fallback={<Skeleton className="h-40" />}>
                  <AnomalyChart data={stats.chart} />
                </Suspense>
              ) : (
                <p className="py-8 text-center text-sm text-muted">{loading ? 'Loading…' : 'No anomalies so far.'}</p>
              )}
            </section>
          </div>
          <section className="card h-fit p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">{t('radar', lang)}</h2>
              <Link to="/radar" className="text-sm text-yellow hover:underline">
                Calendar
              </Link>
            </div>
            {data ? <RadarList obligations={data.obligations} docs={data.docs} compact /> : <Skeleton className="h-48" />}
          </section>
        </div>
      )}
    </div>
  );
}
