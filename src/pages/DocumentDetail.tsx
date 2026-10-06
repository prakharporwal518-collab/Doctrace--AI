import { ArrowLeft, Download, FileDown, FlaskConical, Info, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSession } from '@/app/auth';
import { useData } from '@/app/data';
import { t } from '@/app/i18n';
import { useToast } from '@/app/toast';
import { useAsync } from '@/app/useAsync';
import { AnomaliesTab } from '@/components/detail/AnomaliesTab';
import { ChatTab } from '@/components/detail/ChatTab';
import { EvidenceLockTest } from '@/components/detail/EvidenceLockTest';
import { ExtractionsTab } from '@/components/detail/ExtractionsTab';
import { MissingTab } from '@/components/detail/MissingTab';
import { ObligationsTab } from '@/components/detail/ObligationsTab';
import { DocumentViewer, type Highlight } from '@/components/DocumentViewer';
import { Badge, Button, ErrorState, Modal, Skeleton, Tabs, TrustRing } from '@/components/ui';
import { DOC_TYPE_LABEL, KIND } from '@/lib/categories';
import { trustScore } from '@/lib/engine/trust';
import { buildEvidencePack, downloadBlob } from '@/lib/report';
import { recomputeVendors } from '@/lib/services/vendors';
import type { Citation, Correction } from '@/lib/types';

type Tab = 'extractions' | 'anomalies' | 'missing' | 'obligations' | 'chat';

export default function DocumentDetail() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const { repo, profile } = useSession();
  const { version, bump } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const lang = profile.language;

  const { data, error, loading, reload } = useAsync(async () => {
    const bundle = await repo.getBundle(id);
    const corrections = bundle ? await repo.listCorrections(bundle.extractions.map((e) => e.id)) : [];
    return { bundle, corrections };
  }, [repo, id, version]);

  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'extractions');
  const [active, setActive] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);
  const [focus, setFocus] = useState<Highlight | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [trustOpen, setTrustOpen] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);

  const bundle = data?.bundle ?? null;
  const fileRef = bundle ? { id: bundle.document.id, file_url: bundle.document.file_url, mime_type: bundle.document.mime_type } : null;
  const fileKey = fileRef ? `${fileRef.id}|${fileRef.file_url}` : '';
  // Stable across reloads of the bundle, so the viewer doesn't re-download the file.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadFile = useCallback(() => repo.getFile(fileRef!), [repo, fileKey]);

  // Highlight boxes for every finding that has a location.
  const highlights = useMemo<Highlight[]>(() => {
    if (!bundle) return [];
    const hs: Highlight[] = [];
    for (const e of bundle.extractions) if (e.reviewer_status !== 'rejected') hs.push({ id: `ex:${e.id}`, page: e.page, line: e.line, bbox: e.bbox, color: KIND[e.category].color, label: `${e.label}: ${e.value}` });
    for (const a of bundle.anomalies) {
      if (a.page) hs.push({ id: `an:${a.id}`, page: a.page, line: a.line ?? 0, bbox: a.bbox, color: KIND.anomaly.color, label: a.title });
      a.related.forEach((r, i) => !r.document_id && hs.push({ id: `rel:${a.id}:${i}`, page: r.page, line: r.line, bbox: r.bbox, color: KIND.anomaly.color, label: `Checked for: ${a.title}` }));
    }
    for (const o of bundle.obligations) if (o.page && o.bbox) hs.push({ id: `ob:${o.id}`, page: o.page, line: o.line ?? 0, bbox: o.bbox, color: KIND.obligation.color, label: `${o.party}: ${o.action}` });
    // Related citations only show while selected, to avoid clutter.
    const visible = hs.filter((h) => !h.id.startsWith('rel:') || h.id === active);
    return focus ? [...visible, focus] : visible;
  }, [bundle, focus, active]);

  const tabOf = (hid: string): Tab => (hid.startsWith('ex:') ? 'extractions' : hid.startsWith('an:') || hid.startsWith('rel:') ? 'anomalies' : hid.startsWith('ob:') ? 'obligations' : 'chat');

  const locate = useCallback((hid: string) => {
    setActive(hid);
    setPulse((p) => p + 1);
    // On small screens the viewer is above the cards: bring it into view.
    if (window.matchMedia('(max-width: 1023px)').matches) viewerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const lineFocus = useCallback(
    (c: Citation, key: string) => {
      const line = bundle?.document.pages?.find((p) => p.number === c.page)?.lines.find((l) => l.line === c.line);
      setFocus({ id: key, page: c.page, line: c.line, bbox: c.bbox ?? line?.bbox ?? null, color: '#ffd43b', label: c.source_text });
      locate(key);
    },
    [bundle, locate],
  );

  // Clicking a box in the document opens its card.
  const onBoxSelect = (hid: string) => {
    setActive(hid);
    setPulse((p) => p + 1);
    if (hid.startsWith('chat:') || hid.startsWith('line:')) return;
    const next = tabOf(hid);
    setTab(next);
    const cardId = hid.startsWith('rel:') ? `an:${hid.split(':')[1]}` : hid;
    requestAnimationFrame(() => document.getElementById(`card-${cardId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };

  // Deep links: ?line=2-18 (from Three-Way Match, Radar, related citations) or ?find=<kind>:<id>.
  // Handled while rendering, once per link, as soon as the document has loaded.
  const deepLine = params.get('line');
  const deepFind = params.get('find');
  const deepKey = bundle && (deepLine || deepFind) ? `${bundle.document.id}|${deepLine}|${deepFind}` : '';
  const [handledDeep, setHandledDeep] = useState('');
  if (deepKey && deepKey !== handledDeep && bundle) {
    setHandledDeep(deepKey);
    if (deepLine) {
      const [p, l] = deepLine.split('-').map(Number);
      const pl = bundle.document.pages?.find((x) => x.number === p)?.lines.find((x) => x.line === l);
      if (pl) {
        setFocus({ id: `line:${p}:${l}`, page: p, line: l, bbox: pl.bbox, color: '#ffd43b', label: pl.text });
        setActive(`line:${p}:${l}`);
        setPulse((x) => x + 1);
      }
    } else if (deepFind) {
      const kind = deepFind.split(':')[0];
      setTab(kind === 'an' ? 'anomalies' : kind === 'ob' ? 'obligations' : 'extractions');
      setActive(deepFind);
      setPulse((x) => x + 1);
    }
  }

  if (loading && !data) return <DetailSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!bundle) {
    return (
      <div className="py-16 text-center">
        <p className="text-lg font-semibold">Document not found</p>
        <p className="mt-1 text-muted">It may have been deleted, or it belongs to another account.</p>
        <Link to="/documents" className="mt-4 inline-block text-yellow hover:underline">
          ← Back to documents
        </Link>
      </div>
    );
  }

  const d = bundle.document;
  const trust = trustScore({ anomalies: bundle.anomalies, missing: bundle.missing, confidences: bundle.extractions.map((e) => e.confidence) });
  const corrections: Correction[] = data?.corrections ?? [];

  const exportPack = async () => {
    setExporting(true);
    try {
      const blob = await buildEvidencePack(bundle, await repo.getFile(d), corrections);
      downloadBlob(blob, `evidence-pack_${d.file_name.replace(/\.[^.]+$/, '')}.pdf`);
      await repo.log('export', { format: 'pdf', report: 'Evidence Pack', file_name: d.file_name, findings: bundle.anomalies.length + bundle.missing.length }, d.id);
      toast.success('Evidence Pack downloaded', 'Every finding with its citation and a screenshot of the source line.');
      bump();
    } catch (err) {
      toast.error('Export failed', (err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const downloadOriginal = async () => {
    try {
      downloadBlob(await repo.getFile(d), d.file_name);
    } catch (err) {
      toast.error('Download failed', (err as Error).message);
    }
  };

  const remove = async () => {
    try {
      await repo.deleteDocument(d.id);
      await repo.log('delete', { file_name: d.file_name, sha256: d.sha256_hash }, null);
      await recomputeVendors(repo);
      toast.success('Document deleted', d.file_name);
      bump();
      navigate('/documents');
    } catch (err) {
      toast.error('Could not delete', (err as Error).message);
    }
  };

  const tabs: Array<{ id: Tab; label: string; count?: number; tone?: string }> = [
    { id: 'extractions', label: t('extractions', lang), count: bundle.extractions.length },
    { id: 'anomalies', label: t('anomalies', lang), count: bundle.anomalies.length, tone: bundle.anomalies.length ? KIND.anomaly.color : undefined },
    { id: 'missing', label: t('missing', lang), count: bundle.missing.length, tone: bundle.missing.length ? KIND.missing.color : undefined },
    { id: 'obligations', label: t('obligations', lang), count: bundle.obligations.length },
    { id: 'chat', label: t('chat', lang), count: bundle.chat.filter((m) => m.role === 'user').length },
  ];

  return (
    <div>
      <Link to="/documents" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> {t('documents', lang)}
      </Link>

      <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <button type="button" onClick={() => setTrustOpen(true)} className="rounded-full" title="How this score was calculated">
            <TrustRing score={d.trust_score} size={64} />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{d.file_name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted">
              <Badge>{DOC_TYPE_LABEL[d.doc_type]}</Badge>
              <span>{d.page_count} page{d.page_count === 1 ? '' : 's'}</span>
              <span>· {new Date(d.uploaded_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              <span className="font-mono text-xs text-faint" title={`SHA-256 ${d.sha256_hash}`}>
                · sha256 {d.sha256_hash.slice(0, 12)}…
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setTestOpen(true)} disabled={d.status !== 'ready'}>
            <FlaskConical className="size-4" /> Stress-test
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void exportPack()} loading={exporting} disabled={d.status !== 'ready'}>
            <FileDown className="size-4" /> Evidence Pack
          </Button>
          <Button size="sm" onClick={() => void downloadOriginal()} aria-label="Download original">
            <Download className="size-4" />
          </Button>
          <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)} aria-label="Delete document">
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {d.status === 'failed' && <ErrorState title="Processing failed" error={d.error_message ?? 'Unknown error'} />}
      {d.status === 'processing' && <p className="mb-4 rounded-lg border border-yellow/30 bg-yellow/5 p-3 text-sm text-yellow">This document is still being processed. Refresh in a moment.</p>}
      {d.tamper_warning && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-missing/40 bg-missing/10 p-3 text-sm text-[#ffb877]" role="alert">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" /> <span><b>Tamper check:</b> {d.tamper_warning}</span>
        </p>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line bg-navy-2 px-4 py-2.5 text-sm">
        <span className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-amount" />
          <b className="tabular-nums">{d.fields_extracted}</b> fields extracted, <b className={d.fields_discarded ? 'text-anomaly tabular-nums' : 'tabular-nums'}>{d.fields_discarded}</b> discarded for missing evidence
        </span>
        <span className="text-faint">·</span>
        <span className="text-muted">
          engine: <span className="font-mono text-xs">{d.engine}</span>
        </span>
        {d.completeness != null && (
          <>
            <span className="text-faint">·</span>
            <span className="text-muted">completeness {d.completeness}/100</span>
          </>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div ref={viewerRef} className="scroll-mt-4 lg:sticky lg:top-6 lg:h-[calc(100dvh-3rem)]">
          <div className="h-[70vh] lg:h-full">
            <DocumentViewer key={d.id} doc={d} loadFile={loadFile} highlights={highlights} activeId={active} pulseKey={pulse} onSelect={onBoxSelect} />
          </div>
        </div>
        <div className="min-w-0">
          <Tabs tabs={tabs} value={tab} onChange={setTab} className="mb-4" />
          {tab === 'extractions' && <ExtractionsTab extractions={bundle.extractions} corrections={corrections} activeId={active} onLocate={locate} onChanged={() => { reload(); bump(); }} />}
          {tab === 'anomalies' && <AnomaliesTab anomalies={bundle.anomalies} activeId={active} onLocate={locate} />}
          {tab === 'missing' && <MissingTab pages={d.pages} extractions={bundle.extractions} onLocate={locate} />}
          {tab === 'obligations' && <ObligationsTab obligations={bundle.obligations} fileName={d.file_name} activeId={active} onLocate={locate} onChanged={() => { reload(); bump(); }} />}
          {tab === 'chat' && <ChatTab documentId={d.id} docType={d.doc_type} pages={d.pages} messages={bundle.chat} onLocateCitation={lineFocus} onChanged={reload} />}
        </div>
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this document?">
        <p className="text-sm text-muted">
          <b className="text-ink">{d.file_name}</b>, its extracted fields, anomalies, obligations and chat will be deleted. The audit trail keeps a record of the deletion.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => void remove()}>
            <Trash2 className="size-4" /> Delete
          </Button>
        </div>
      </Modal>

      <Modal open={trustOpen} onClose={() => setTrustOpen(false)} title="How the trust score is calculated">
        <div className="flex items-center gap-4">
          <TrustRing score={d.trust_score} size={72} />
          <p className="text-sm text-muted">Start at 100. Lose points for every anomaly and missing field (by severity), and for low average extraction confidence. Nothing hidden.</p>
        </div>
        <ul className="mt-4 divide-y divide-line text-sm">
          <li className="flex justify-between py-2">
            <span>Starting score</span>
            <span className="tabular-nums">100</span>
          </li>
          {trust.parts.map((p) => (
            <li key={p.label} className="flex justify-between py-2">
              <span className="text-muted">{p.label}</span>
              <span className="text-anomaly tabular-nums">{p.points}</span>
            </li>
          ))}
          <li className="flex justify-between py-2 font-semibold">
            <span>Trust score</span>
            <span className="tabular-nums">{trust.score}</span>
          </li>
        </ul>
        <p className="mt-3 flex items-start gap-2 text-xs text-faint">
          <Info className="mt-0.5 size-3.5 shrink-0" /> High anomaly −15, medium −7, low −3. Missing high-priority field −8, medium −5, low −2. Confidence: −40 × (1 − average).
        </p>
      </Modal>

      {d.pages && <EvidenceLockTest open={testOpen} onClose={() => setTestOpen(false)} parsed={{ pages: d.pages, source: 'pdf-text' }} extractions={bundle.extractions} documentId={d.id} />}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div role="status" aria-label="Loading document">
      <Skeleton className="mb-6 h-16 w-2/3" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-[70vh]" />
        <div className="space-y-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    </div>
  );
}

