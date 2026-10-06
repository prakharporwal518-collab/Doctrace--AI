import { FileStack, Search, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSession } from '@/app/auth';
import { useData } from '@/app/data';
import { t } from '@/app/i18n';
import { useAsync } from '@/app/useAsync';
import { DocRow } from '@/components/DocRow';
import { Button, EmptyState, ErrorState, PageHeader, SkeletonRows } from '@/components/ui';
import { DOC_TYPE_LABEL } from '@/lib/categories';

export default function Documents() {
  const { repo, profile } = useSession();
  const { version, openUpload } = useData();
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [trust, setTrust] = useState('all');
  const { data, error, loading, reload } = useAsync(async () => {
    const [docs, anomalies] = await Promise.all([repo.listDocuments(), repo.listAnomalies()]);
    const counts = new Map<string, number>();
    for (const a of anomalies) counts.set(a.document_id, (counts.get(a.document_id) ?? 0) + 1);
    return { docs, counts };
  }, [repo, version]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.docs ?? []).filter((d) => {
      if (needle && !d.file_name.toLowerCase().includes(needle) && !DOC_TYPE_LABEL[d.doc_type].toLowerCase().includes(needle)) return false;
      if (type !== 'all' && d.doc_type !== type) return false;
      if (status !== 'all' && d.status !== status) return false;
      const s = d.trust_score;
      if (trust === 'high' && !(s != null && s >= 80)) return false;
      if (trust === 'mid' && !(s != null && s >= 60 && s < 80)) return false;
      if (trust === 'low' && !(s != null && s < 60)) return false;
      return true;
    });
  }, [data, q, type, status, trust]);

  const filtered = q || type !== 'all' || status !== 'all' || trust !== 'all';

  return (
    <div>
      <PageHeader
        title={t('documents', profile.language)}
        subtitle={data ? `${data.docs.length} document${data.docs.length === 1 ? '' : 's'}` : undefined}
        actions={
          <Button variant="primary" onClick={openUpload}>
            <Upload className="size-4" /> {t('upload', profile.language)}
          </Button>
        }
      />
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <label className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <input className="input pl-9" placeholder="Search by file name or type" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" />
        </label>
        <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
          <option value="all">All types</option>
          {Object.entries(DOC_TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="all">Any status</option>
          <option value="ready">Ready</option>
          <option value="processing">Processing</option>
          <option value="failed">Failed</option>
        </select>
        <select className="input w-auto" value={trust} onChange={(e) => setTrust(e.target.value)} aria-label="Filter by trust score">
          <option value="all">Any trust score</option>
          <option value="high">80–100 (good)</option>
          <option value="mid">60–79 (fair)</option>
          <option value="low">Below 60 (poor)</option>
        </select>
      </div>

      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && !data ? (
        <SkeletonRows rows={5} />
      ) : !data?.docs.length ? (
        <EmptyState icon={<FileStack className="size-8" />} title="No documents yet" body="Upload a PDF, DOCX, JPG or PNG to get started." action={<Button variant="primary" onClick={openUpload}>Upload</Button>} />
      ) : !shown.length ? (
        <EmptyState title="Nothing matches these filters" action={filtered && <Button onClick={() => { setQ(''); setType('all'); setStatus('all'); setTrust('all'); }}>Clear filters</Button>} />
      ) : (
        <div className="card divide-y divide-line p-1">
          {shown.map((d) => (
            <DocRow key={d.id} d={d} anomalies={data.counts.get(d.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
