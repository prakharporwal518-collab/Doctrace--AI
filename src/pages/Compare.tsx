import { GitCompareArrows, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/app/auth';
import { useData } from '@/app/data';
import { t } from '@/app/i18n';
import { useToast } from '@/app/toast';
import { useAsync } from '@/app/useAsync';
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonRows, cx } from '@/components/ui';
import { diffContracts } from '@/lib/engine/diff';
import { SERVICE_AGREEMENT_V2 } from '@/lib/pdfgen/samples';
import { sampleFile } from '@/lib/services/samples';
import { uploadAndProcess } from '@/lib/services/upload';

export default function Compare() {
  const { repo, profile } = useSession();
  const { version, bump } = useData();
  const toast = useToast();
  const { data: docs, error, loading, reload } = useAsync(async () => (await repo.listDocuments()).filter((d) => d.status === 'ready' && (d.doc_type === 'contract' || d.doc_type === 'other')), [repo, version]);
  const [pickA, setA] = useState('');
  const [pickB, setB] = useState('');
  const [adding, setAdding] = useState(false);
  // Default: oldest contract as the original, newest as the revision.
  const sorted = [...(docs ?? [])].sort((x, y) => x.uploaded_at.localeCompare(y.uploaded_at));
  const a = pickA || sorted[0]?.id || '';
  const b = pickB || (sorted.length > 1 ? sorted[sorted.length - 1].id : '');

  const { data: diff, loading: diffing, error: diffError } = useAsync(async () => {
    if (!a || !b || a === b) return null;
    const [x, y] = await Promise.all([repo.getBundle(a), repo.getBundle(b)]);
    if (!x?.document.pages || !y?.document.pages) throw new Error('One of the documents has no text to compare.');
    return { ...diffContracts(x.document.pages, y.document.pages), aName: x.document.file_name, bName: y.document.file_name };
  }, [repo, a, b]);

  const addRevised = async () => {
    setAdding(true);
    try {
      const r = await uploadAndProcess(await sampleFile(SERVICE_AGREEMENT_V2), { repo, profile });
      setB(r.documentId);
      toast.success('Revised contract added', 'Compared against the original below.');
      bump();
    } catch (err) {
      toast.error('Could not add the revised contract', (err as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const pick = (label: string, value: string, set: (v: string) => void) => (
    <label className="text-sm">
      <span className="label">{label}</span>
      <select className="input mt-1" value={value} onChange={(e) => set(e.target.value)}>
        <option value="">— choose —</option>
        {docs?.map((d) => (
          <option key={d.id} value={d.id}>
            {d.file_name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div>
      <PageHeader title={t('compare', profile.language)} subtitle="Upload a revised contract and see exactly which clauses changed, with citations." />
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && !docs ? (
        <SkeletonRows />
      ) : (
        <>
          <div className="card mb-5 grid gap-3 p-4 sm:grid-cols-2">
            {pick('Original', a, setA)}
            {pick('Revised version', b, setB)}
            <button type="button" onClick={() => void addRevised()} disabled={adding} className="flex items-center gap-1 text-left text-xs text-yellow hover:underline disabled:opacity-50 sm:col-span-2">
              <Plus className="size-3" /> {adding ? 'Processing the revised agreement…' : 'Add the sample revised agreement (service_agreement_nexa_v2.pdf)'}
            </button>
          </div>
          {diffError && <ErrorState error={diffError} />}
          {!a || !b || a === b ? (
            <EmptyState icon={<GitCompareArrows className="size-8" />} title="Choose two versions" body="Pick the original contract and its revised version. Clauses are matched by number (4.1, 4.2, …)." />
          ) : diffing && !diff ? (
            <SkeletonRows rows={3} />
          ) : diff ? (
            <>
              <section className="card mb-5 p-4">
                <h2 className="mb-2 font-semibold">Summary of changes</h2>
                {diff.summary.length ? (
                  <ul className="space-y-1.5 text-sm">
                    {diff.summary.map((s) => (
                      <li key={s} className="flex gap-2">
                        <span className="text-yellow">•</span>
                        <span>
                          {s.replace(/\s\(p\.\d+ · L\d+\)$/, '')} <span className="cite text-yellow/90">{s.match(/\((p\.\d+ · L\d+)\)$/)?.[1]}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No clause changed between these two versions.</p>
                )}
              </section>
              <div className="space-y-3">
                {diff.changes.map((c) => (
                  <section key={c.id} className="card p-4">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">Clause {c.id}</span>
                      <Badge className={c.kind === 'added' ? 'text-amount' : c.kind === 'removed' ? 'text-anomaly' : 'text-yellow'}>{c.kind}</Badge>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-lg border border-line bg-navy-2 p-3">
                        <p className="label mb-1.5 flex justify-between">
                          <span>{diff.aName}</span>
                          {c.before && <Link to={`/documents/${a}?line=${c.before.page}-${c.before.line}`} className="cite text-yellow/90 normal-case hover:underline">↳ p.{c.before.page} · L{c.before.line}</Link>}
                        </p>
                        <p className="font-serif text-[14px] leading-relaxed">{c.tokens.map((tk, i) => (tk.op === 'add' ? null : <span key={i} className={cx(tk.op === 'del' && 'rounded-sm bg-anomaly/25 text-[#ffb3ba] line-through')}>{tk.text}</span>))}</p>
                      </div>
                      <div className="rounded-lg border border-line bg-navy-2 p-3">
                        <p className="label mb-1.5 flex justify-between">
                          <span>{diff.bName}</span>
                          {c.after && <Link to={`/documents/${b}?line=${c.after.page}-${c.after.line}`} className="cite text-yellow/90 normal-case hover:underline">↳ p.{c.after.page} · L{c.after.line}</Link>}
                        </p>
                        <p className="font-serif text-[14px] leading-relaxed">{c.tokens.map((tk, i) => (tk.op === 'del' ? null : <span key={i} className={cx(tk.op === 'add' && 'rounded-sm bg-amount/25 text-[#9ff0c8]')}>{tk.text}</span>))}</p>
                      </div>
                    </div>
                  </section>
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
