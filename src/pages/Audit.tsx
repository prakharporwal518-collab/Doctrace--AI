import { ClipboardList, Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/app/auth';
import { useData } from '@/app/data';
import { t } from '@/app/i18n';
import { useAsync } from '@/app/useAsync';
import { Badge, Button, EmptyState, ErrorState, PageHeader, SkeletonRows } from '@/components/ui';
import { downloadBlob } from '@/lib/report';
import type { AuditLog } from '@/lib/types';

const LABEL: Record<string, string> = {
  upload: 'Uploaded',
  extraction: 'Extracted & verified',
  evidence_rejected: 'Evidence Lock rejections',
  evidence_lock_test: 'Evidence Lock stress test',
  tamper_warning: 'Tamper warning',
  review: 'Review',
  export: 'Export',
  chat: 'Question asked',
  obligation: 'Obligation updated',
  three_way_match: 'Three-way match linked',
  delete: 'Deleted',
  upload_failed: 'Upload failed',
};

function summary(l: AuditLog): string {
  const d = l.details as Record<string, unknown>;
  switch (l.action) {
    case 'upload':
      return `${d.file_name} · ${Math.round(Number(d.size) / 1024)} KB · sha256 ${String(d.sha256 ?? '').slice(0, 12)}…`;
    case 'extraction':
      return `${d.fields} fields, ${d.discarded} discarded · ${d.anomalies} anomalies · ${d.missing} missing · trust ${d.trust_score} · ${d.engine}${d.ocr ? ' · OCR' : ''}`;
    case 'evidence_rejected':
      return `${d.count} field(s) discarded: no evidence at the cited line`;
    case 'evidence_lock_test':
      return `${d.accepted} accepted, ${(d.rejected as unknown[])?.length ?? 0} discarded`;
    case 'review':
      if (d.action) return `${String(d.action)}: ${d.label}${d.to ? ` → “${d.to}”` : ''}`;
      return `Approved ${(d.approved as string[] | undefined)?.join(', ') || 'none'}${(d.corrected as unknown[] | undefined)?.length ? ' · 1 correction' : ''}`;
    case 'export':
      return `${String(d.report ?? d.format).toString()}${d.file_name ? ` · ${d.file_name}` : ''}${d.events ? ` · ${d.events} events` : ''}`;
    case 'chat':
      return `“${d.question}” · ${d.citations} citation(s)`;
    case 'tamper_warning':
      return String(d.message ?? '');
    case 'delete':
      return String(d.file_name ?? '');
    case 'upload_failed':
      return `${d.file_name}: ${d.error}`;
    default:
      return JSON.stringify(d).slice(0, 160);
  }
}

export default function Audit() {
  const { repo, profile } = useSession();
  const { version } = useData();
  const [filter, setFilter] = useState('all');
  const { data, error, loading, reload } = useAsync(async () => {
    const [logs, docs] = await Promise.all([repo.listAudit(1000), repo.listDocuments()]);
    return { logs, names: new Map(docs.map((d) => [d.id, d.file_name])) };
  }, [repo, version]);
  const actions = useMemo(() => [...new Set(data?.logs.map((l) => l.action) ?? [])], [data]);
  const shown = (data?.logs ?? []).filter((l) => filter === 'all' || l.action === filter);

  const exportCsv = () => {
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const rows = [['timestamp', 'action', 'document', 'details'], ...shown.map((l) => [l.created_at, l.action, data?.names.get(l.document_id ?? '') ?? l.document_id ?? '', JSON.stringify(l.details)])];
    downloadBlob(new Blob([rows.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv' }), 'doctrace-audit-log.csv');
  };

  return (
    <div>
      <PageHeader
        title={t('audit', profile.language)}
        subtitle="Every upload, extraction, rejection, review and export, with timestamps."
        actions={
          <>
            <select className="input w-auto" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by action">
              <option value="all">All actions</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {LABEL[a] ?? a}
                </option>
              ))}
            </select>
            <Button onClick={exportCsv} disabled={!shown.length}>
              <Download className="size-4" /> CSV
            </Button>
          </>
        }
      />
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && !data ? (
        <SkeletonRows rows={6} />
      ) : !shown.length ? (
        <EmptyState icon={<ClipboardList className="size-8" />} title="Nothing logged yet" />
      ) : (
        <ol className="relative space-y-0 border-l border-line pl-5">
          {shown.map((l) => (
            <li key={l.id} className="relative pb-4">
              <span className={`absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4 ring-navy ${/rejected|failed|tamper|delete/.test(l.action) ? 'bg-anomaly' : l.action === 'review' ? 'bg-obligation' : l.action === 'export' ? 'bg-purple' : 'bg-amount'}`} />
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="font-mono text-xs text-faint">{new Date(l.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' })}</span>
                <Badge>{LABEL[l.action] ?? l.action}</Badge>
                {l.document_id && data?.names.has(l.document_id) && (
                  <Link to={`/documents/${l.document_id}`} className="text-sm text-yellow hover:underline">
                    {data.names.get(l.document_id)}
                  </Link>
                )}
              </div>
              <p className="mt-1 text-sm break-words text-muted">{summary(l)}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
