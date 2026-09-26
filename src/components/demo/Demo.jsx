import { useCallback, useMemo, useState } from 'react';
import { DEMO } from '../../data/content.js';
import { SAMPLES } from '../../data/samples.js';
import { analyzeDocuments, toExportJSON } from '../../engine/analyze.js';
import { documentFromText } from '../../engine/document.js';
import { DocTraceError, MAX_FILES, parseFile } from '../../engine/parsers.js';
import { citationLabel } from '../../lib/citation.js';
import { downloadText, toCSV } from '../../lib/download.js';
import ErrorBoundary from '../ErrorBoundary.jsx';
import Icon from '../Icon.jsx';
import Section from '../Section.jsx';
import DocumentViewer from './DocumentViewer.jsx';
import Dropzone from './Dropzone.jsx';
import FindingsList from './FindingsList.jsx';
import { FILTERS } from './filters.js';

const TYPE_LABEL = { invoice: 'Invoice', contract: 'Contract', report: 'Report', compliance: 'Compliance', other: 'Document' };
const MAX_PASTE_CHARS = 500000;

let noticeId = 0;

function uniqueName(name, taken) {
  if (!taken.has(name)) return name;
  const m = /^(.*?)(\.[^.]*)?$/.exec(name);
  for (let i = 2; ; i += 1) {
    const candidate = `${m[1]} (${i})${m[2] || ''}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export default function Demo() {
  const [docs, setDocs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState([]);
  const [activeDocId, setActiveDocId] = useState(null);
  const [page, setPage] = useState(1);
  const [active, setActive] = useState(null);
  const [filter, setFilter] = useState('all');
  const [scope, setScope] = useState('doc'); // 'doc' | 'all'
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteName, setPasteName] = useState('pasted_document.txt');

  const notify = useCallback((file, message, kind = 'error') => {
    noticeId += 1;
    setNotices((n) => [...n.slice(-5), { id: noticeId, file, message, kind }]);
  }, []);

  // Run the engine whenever the document set changes. A crash in the engine
  // becomes a visible notice instead of a blank screen.
  const analysis = useMemo(() => {
    if (!docs.length) return null;
    try {
      return analyzeDocuments(docs, { now: new Date() });
    } catch (err) {
      return { results: [], findings: [], stats: null, errors: [{ file: 'engine', message: String(err?.message || err) }] };
    }
  }, [docs]);

  const activeResult = analysis?.results.find((r) => r.doc.id === activeDocId) || analysis?.results[0] || null;
  const activeDoc = activeResult?.doc || null;

  const addDocs = useCallback(
    (newDocs) => {
      if (!newDocs.length) return;
      setDocs((prev) => {
        const taken = new Set(prev.map((d) => d.name));
        const renamed = newDocs.map((d) => {
          const name = uniqueName(d.name, taken);
          taken.add(name);
          return name === d.name ? d : { ...d, name };
        });
        return [...prev, ...renamed];
      });
      setActiveDocId(newDocs[0].id);
      setPage(1);
      setActive(null);
    },
    [],
  );

  const loadSamples = () => {
    const loaded = new Set(docs.map((d) => d.name));
    const fresh = SAMPLES.filter((s) => !loaded.has(s.name)).map((s) => documentFromText(s.name, s.text));
    if (!fresh.length) {
      notify('Samples', 'The sample documents are already loaded.', 'info');
      return;
    }
    if (docs.length + fresh.length > MAX_FILES) {
      notify('Samples', `You can analyse up to ${MAX_FILES} documents at once. Remove some first.`);
      return;
    }
    addDocs(fresh);
  };

  const onFiles = async (files) => {
    const room = MAX_FILES - docs.length;
    if (room <= 0) {
      notify('Upload', `You can analyse up to ${MAX_FILES} documents at once. Remove some first.`);
      return;
    }
    const accepted = files.slice(0, room);
    if (files.length > room) notify('Upload', `Only the first ${room} file(s) were added (limit ${MAX_FILES}).`);

    setBusy(true);
    try {
      const results = await Promise.allSettled(accepted.map((f) => parseFile(f)));
      const good = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') good.push(r.value);
        else {
          const msg = r.reason instanceof DocTraceError ? r.reason.message : `Unexpected error: ${r.reason?.message || r.reason}`;
          notify(accepted[i].name, msg);
        }
      });
      addDocs(good);
    } finally {
      setBusy(false);
    }
  };

  const onPaste = () => {
    const text = pasteText.trim();
    if (!text) {
      notify('Paste', 'Paste some document text first.');
      return;
    }
    if (text.length > MAX_PASTE_CHARS) {
      notify('Paste', `That is too much text (${text.length.toLocaleString()} characters). The limit is ${MAX_PASTE_CHARS.toLocaleString()}.`);
      return;
    }
    if (docs.length >= MAX_FILES) {
      notify('Paste', `You can analyse up to ${MAX_FILES} documents at once. Remove some first.`);
      return;
    }
    const name = (pasteName.trim() || 'pasted_document.txt').replace(/[\\/:*?"<>|]/g, '_');
    addDocs([documentFromText(name, text)]);
    setPasteText('');
    setPasteOpen(false);
  };

  const removeDoc = (id) => {
    setDocs((prev) => prev.filter((d) => d.id !== id));
    if (activeDocId === id) setActiveDocId(null);
    if (active?.docId === id) setActive(null);
    setPage(1);
  };

  const clearAll = () => {
    setDocs([]);
    setActive(null);
    setActiveDocId(null);
    setPage(1);
    setNotices([]);
  };

  const selectFinding = (f) => {
    if (active?.id === f.id) {
      setActive(null);
      return;
    }
    setActive(f);
    setActiveDocId(f.docId);
    if (f.source && !f.source.schema) setPage(f.source.page);
    // On narrow screens the viewer sits above the list: bring it into view.
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 900px)').matches) {
      requestAnimationFrame(() => document.getElementById('doc-viewer')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  const selectDoc = (id) => {
    setActiveDocId(id);
    setPage(1);
    if (active && active.docId !== id) setActive(null);
  };

  const scoped = useMemo(
    () => (scope === 'all' ? analysis?.findings || [] : activeResult?.findings || []),
    [scope, analysis, activeResult],
  );
  const counts = useMemo(() => {
    const c = { all: scoped.length };
    for (const { key } of FILTERS) if (key !== 'all') c[key] = scoped.filter((f) => f.type === key).length;
    return c;
  }, [scoped]);
  const visible = filter === 'all' ? scoped : scoped.filter((f) => f.type === filter);

  const exportJSON = () => {
    if (!analysis) return;
    const payload = {
      generated_at: new Date().toISOString(),
      engine: 'DocTrace AI browser prototype',
      stats: analysis.stats,
      documents: analysis.results.map((r) => ({ file: r.doc.name, type: r.docType, summary: r.summary, findings: r.findings.map(toExportJSON) })),
    };
    downloadText('doctrace_findings.json', JSON.stringify(payload, null, 2), 'application/json');
  };

  const exportCSV = () => {
    if (!analysis) return;
    const rows = [['file', 'severity', 'type', 'layer', 'label', 'value', 'derived', 'citation', 'quote', 'confidence']];
    for (const f of analysis.findings) {
      rows.push([f.file, f.severity, f.type, f.layer, f.label, f.date || f.value, f.derived, citationLabel(f.source), f.source?.quote || '', f.confidence]);
    }
    downloadText('doctrace_findings.csv', toCSV(rows), 'text/csv');
  };

  const stats = analysis?.stats;
  const engineErrors = analysis?.errors || [];

  return (
    <Section id="demo" kicker={DEMO.kicker} title={DEMO.title}>
      <p className="lead">{DEMO.intro}</p>

      <div className="workspace card">
        <div className="workspace__top">
          <div className="workspace__title">
            <span className="dots" aria-hidden="true"><i /><i /><i /></span>
            <strong>DocTrace AI · Review workspace</strong>
          </div>
          <div className="workspace__actions">
            <button type="button" className="btn btn--primary btn--sm" onClick={loadSamples} disabled={busy}>
              <Icon name="files" size={16} /> Load sample documents
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPasteOpen((o) => !o)} aria-expanded={pasteOpen}>
              Paste text
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={exportJSON} disabled={!analysis?.findings.length}>
              <Icon name="download" size={16} /> JSON
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={exportCSV} disabled={!analysis?.findings.length}>
              <Icon name="download" size={16} /> CSV
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={clearAll} disabled={!docs.length && !notices.length}>
              <Icon name="trash" size={16} /> Clear
            </button>
          </div>
        </div>

        <Dropzone onFiles={onFiles} busy={busy} />
        {busy && <p className="busy" role="status"><span className="spinner" aria-hidden="true" /> Reading files…</p>}

        {pasteOpen && (
          <div className="paste">
            <label className="small" htmlFor="paste-name">File name</label>
            <input id="paste-name" className="input" value={pasteName} onChange={(e) => setPasteName(e.target.value)} maxLength={80} />
            <label className="small" htmlFor="paste-text">Document text (use a line like “--- Page 2 ---” to start a new page)</label>
            <textarea id="paste-text" className="input" rows={8} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste an invoice, contract or report here…" />
            <div className="row gap-sm">
              <button type="button" className="btn btn--primary btn--sm" onClick={onPaste}>Analyse text</button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPasteOpen(false)}>Cancel</button>
            </div>
          </div>
        )}

        {(notices.length > 0 || engineErrors.length > 0) && (
          <ul className="notices" aria-live="polite">
            {engineErrors.map((e, i) => (
              <li key={`engine-${i}`} className="notice notice--error"><strong>{e.file}:</strong> {e.message}</li>
            ))}
            {notices.map((n) => (
              <li key={n.id} className={`notice notice--${n.kind}`}>
                <span><strong>{n.file}:</strong> {n.message}</span>
                <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNotices((all) => all.filter((x) => x.id !== n.id))}>
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="kpis">
          <div className="kpi"><span className="kpi__v">{stats?.documents ?? 0}</span><span className="kpi__l">Documents processed</span></div>
          <div className="kpi"><span className="kpi__v tone-text-yellow">{stats?.deadlinesNext30 ?? 0}</span><span className="kpi__l">Deadlines in next 30 days</span></div>
          <div className="kpi"><span className="kpi__v tone-text-coral">{stats?.anomalies ?? 0}</span><span className="kpi__l">Anomalies flagged</span></div>
          <div className="kpi"><span className="kpi__v tone-text-amber">{stats?.missing ?? 0}</span><span className="kpi__l">Missing mandatory fields</span></div>
        </div>

        {!analysis ? (
          <div className="workspace__empty">
            <Icon name="shield" size={36} />
            <p><strong>No documents yet.</strong></p>
            <p className="muted">Load the samples to see an invoice with a ₹12,400 gap, a duplicate invoice and a contract with a hidden notice deadline.</p>
            <button type="button" className="btn btn--primary" onClick={loadSamples}>Load sample documents</button>
          </div>
        ) : (
          <>
            <div className="doc-tabs" role="tablist" aria-label="Documents">
              {analysis.results.map((r) => {
                const high = r.findings.filter((f) => f.severity === 'HIGH').length;
                const isActive = r.doc.id === activeDoc?.id;
                return (
                  <div key={r.doc.id} className={`doc-tab ${isActive ? 'is-active' : ''}`}>
                    <button type="button" role="tab" aria-selected={isActive} onClick={() => selectDoc(r.doc.id)} title={r.doc.name}>
                      <Icon name="file" size={14} />
                      <span className="ellipsis">{r.doc.name}</span>
                      <span className="doc-tab__type">{TYPE_LABEL[r.docType] || 'Document'}</span>
                      {high > 0 && <span className="badge sev-HIGH">{high}</span>}
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Remove ${r.doc.name}`} onClick={() => removeDoc(r.doc.id)}>
                      <Icon name="x" size={12} />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="panes">
              <div className="pane" id="doc-viewer">
                <ErrorBoundary title="The document viewer hit an error." onReset={() => setActive(null)}>
                  <DocumentViewer doc={activeDoc} page={page} onPage={setPage} active={active} />
                </ErrorBoundary>
                {activeResult && Object.keys(activeResult.summary).length > 0 && (
                  <dl className="summary">
                    {Object.entries(activeResult.summary).map(([k, v]) => (
                      <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>
                    ))}
                  </dl>
                )}
                {activeResult?.checklist?.length > 0 && (
                  <div className="checklist">
                    <p className="label">{activeResult.schemaName} schema</p>
                    <ul className="schema schema--compact">
                      {activeResult.checklist.map((c) => (
                        <li key={c.key} className={c.present ? 'ok' : 'miss'}>
                          <span className="schema__mark" aria-hidden="true">{c.present ? '✓' : '!'}</span>
                          <span>{c.label}</span>
                          {c.present ? <span className="cite">↳ {citationLabel(c.source)}</span> : <span className="badge sev-MEDIUM">Missing</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="pane">
                <div className="scope" role="group" aria-label="Findings scope">
                  <button type="button" className={`seg ${scope === 'doc' ? 'is-active' : ''}`} onClick={() => setScope('doc')} aria-pressed={scope === 'doc'}>This document</button>
                  <button type="button" className={`seg ${scope === 'all' ? 'is-active' : ''}`} onClick={() => setScope('all')} aria-pressed={scope === 'all'}>All documents</button>
                </div>
                <ErrorBoundary title="The findings list hit an error.">
                  <FindingsList
                    findings={visible}
                    filter={filter}
                    onFilter={setFilter}
                    activeId={active?.id}
                    onSelect={selectFinding}
                    counts={counts}
                    scopeLabel={scope === 'all' ? `${analysis.results.length} documents` : activeDoc?.name || ''}
                  />
                </ErrorBoundary>
                <p className="verified small">
                  <Icon name="shield" size={14} /> {stats?.findings ?? 0} findings verified against their source text
                  {stats?.rejected ? `, ${stats.rejected} rejected for failing verification` : ''}.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
