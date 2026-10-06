import { Store } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSession } from '@/app/auth';
import { useData } from '@/app/data';
import { t } from '@/app/i18n';
import { useAsync } from '@/app/useAsync';
import { DocRow } from '@/components/DocRow';
import { cx, EmptyState, ErrorState, PageHeader, SeverityBadge, SkeletonRows } from '@/components/ui';
import { RULES } from '@/lib/engine/anomalies';

function riskTone(r: number) {
  return r >= 50 ? { label: 'High risk', cls: 'text-anomaly', bar: 'bg-anomaly' } : r >= 25 ? { label: 'Medium risk', cls: 'text-missing', bar: 'bg-missing' } : { label: 'Low risk', cls: 'text-amount', bar: 'bg-amount' };
}

export default function Vendors() {
  const { repo, profile } = useSession();
  const { version } = useData();
  const { data, error, loading, reload } = useAsync(async () => {
    const [vendors, docs, anomalies] = await Promise.all([repo.listVendors(), repo.listDocuments(), repo.listAnomalies()]);
    return { vendors: vendors.sort((a, b) => b.risk_score - a.risk_score), docs, anomalies };
  }, [repo, version]);

  return (
    <div>
      <PageHeader title={t('vendors', profile.language)} subtitle="Documents grouped by vendor. Risk rises with low trust scores and high-severity anomalies." />
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && !data ? (
        <SkeletonRows />
      ) : !data?.vendors.length ? (
        <EmptyState icon={<Store className="size-8" />} title="No vendors yet" body="Vendors appear automatically when you upload invoices, purchase orders or contracts." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.vendors.map((v) => {
            const docs = data.docs.filter((d) => d.vendor_id === v.id);
            const ids = new Set(docs.map((d) => d.id));
            const an = data.anomalies.filter((a) => ids.has(a.document_id));
            const tone = riskTone(v.risk_score);
            return (
              <section key={v.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">{v.name}</h2>
                    <p className="mt-0.5 font-mono text-xs text-faint">{v.gstin ? `GSTIN ${v.gstin}` : 'No GSTIN on file'}</p>
                  </div>
                  <div className="text-right">
                    <p className={cx('text-2xl font-semibold tabular-nums', tone.cls)}>{v.risk_score}</p>
                    <p className={cx('text-xs', tone.cls)}>{tone.label}</p>
                  </div>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
                  <div className={cx('h-full rounded-full', tone.bar)} style={{ width: `${v.risk_score}%` }} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-md bg-navy-2 p-2">
                    <dt className="text-xs text-faint">Documents</dt>
                    <dd className="font-semibold tabular-nums">{v.total_documents}</dd>
                  </div>
                  <div className="rounded-md bg-navy-2 p-2">
                    <dt className="text-xs text-faint">Anomalies</dt>
                    <dd className="font-semibold tabular-nums">{v.total_anomalies}</dd>
                  </div>
                </dl>
                {an.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {an.slice(0, 4).map((a) => (
                      <li key={a.id}>
                        <Link to={`/documents/${a.document_id}?find=an:${a.id}`} className="flex items-center gap-2 text-sm hover:underline">
                          <SeverityBadge severity={a.severity} />
                          <span className="truncate">{RULES[a.rule_code]?.name ?? a.title}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="-mx-2 mt-3 border-t border-line pt-2">
                  {docs.map((d) => (
                    <DocRow key={d.id} d={d} />
                  ))}
                </div>
                <p className="mt-2 text-xs text-faint">Risk = (100 − average trust) × 0.8 + 8 per high and 3 per medium anomaly, capped at 100.</p>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
