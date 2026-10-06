// Upload: drag & drop with a live pipeline per file.
import { AlertTriangle, Check, FileText, FileUp, Loader2, ShieldAlert, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/app/auth';
import { useData } from '@/app/data';
import { useToast } from '@/app/toast';
import { ACCEPT, IngestError, MAX_BYTES } from '@/lib/ingest';
import { sampleFile, UPLOAD_SAMPLES } from '@/lib/services/samples';
import { uploadAndProcess, type Stage, type UploadResult } from '@/lib/services/upload';
import { Button, cx, Modal } from './ui';

const STAGES: Array<{ id: Stage; label: string }> = [
  { id: 'uploading', label: 'Uploading' },
  { id: 'ocr', label: 'OCR' },
  { id: 'extracting', label: 'Extracting' },
  { id: 'verifying', label: 'Verifying' },
  { id: 'done', label: 'Done' },
];

interface Job {
  id: number;
  name: string;
  stage: Stage | 'queued';
  detail?: string;
  error?: string;
  result?: UploadResult;
}

export function UploadDialog() {
  const { uploadOpen, closeUpload, bump } = useData();
  const { repo, profile } = useSession();
  const toast = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);

  const update = (id: number, patch: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  const run = async (files: File[]) => {
    if (!files.length || busy) return;
    const fresh = files.slice(0, 10).map((f) => ({ id: nextId.current++, name: f.name, stage: 'queued' as const }));
    if (files.length > 10) toast.info('Only the first 10 files were added', 'Upload the rest in another batch.');
    setJobs((js) => [...fresh, ...js].slice(0, 20));
    setBusy(true);
    for (const [i, file] of files.slice(0, 10).entries()) {
      const id = fresh[i].id;
      try {
        const result = await uploadAndProcess(file, { repo, profile, onStage: (stage, detail) => update(id, { stage, detail }) });
        update(id, { stage: 'done', result, detail: undefined });
        if (result.duplicateOf) toast.info(`${file.name} is already in your library`, `Identical file uploaded on ${new Date(result.duplicateOf.uploaded_at).toLocaleDateString('en-IN')}. Nothing was changed.`);
        else if (result.tamperWarning) toast.error('Tamper check: document modified', result.tamperWarning);
        else toast.success(`${file.name} processed`, `${result.fieldsExtracted} fields extracted, ${result.fieldsDiscarded} discarded for missing evidence.`);
        if (result.aiNote) toast.info('Rules engine used', result.aiNote);
        bump();
      } catch (err) {
        const message = err instanceof IngestError ? err.message : (err as Error)?.message ?? 'Unknown error';
        update(id, { error: message });
        toast.error(`Could not process ${file.name}`, message);
        bump();
      }
    }
    setBusy(false);
  };

  const runSample = async (key: string) => {
    const s = UPLOAD_SAMPLES.find((x) => x.key === key);
    if (!s) return;
    try {
      await run([await sampleFile(s)]);
    } catch (err) {
      toast.error('Could not create the sample', (err as Error).message);
    }
  };

  return (
    <Modal open={uploadOpen} onClose={closeUpload} title="Upload documents" wide>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void run(Array.from(e.dataTransfer.files));
        }}
        className={cx('flex flex-col items-center gap-3 rounded-[10px] border-2 border-dashed px-6 py-10 text-center transition-colors', over ? 'border-yellow bg-yellow/5' : 'border-line-2')}
      >
        <FileUp className="size-8 text-faint" />
        <div>
          <p className="font-semibold">Drop PDF, DOCX, JPG or PNG files here</p>
          <p className="text-sm text-muted">Up to {MAX_BYTES / 1048576} MB each. Scans and phone photos are read with OCR (English + Hindi).</p>
        </div>
        <Button variant="primary" onClick={() => input.current?.click()} disabled={busy}>
          Choose files
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            void run(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
        {profile.privacy_mode && <p className="text-xs text-amount">Privacy mode is on: personal numbers are masked before anything reaches the AI model.</p>}
      </div>

      {jobs.length > 0 && (
        <ul className="mt-5 space-y-3">
          {jobs.map((j) => (
            <li key={j.id} className="rounded-lg border border-line bg-navy-2 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <FileText className="size-4 shrink-0 text-faint" />
                  <span className="truncate">{j.name}</span>
                </p>
                {j.result && !j.result.duplicateOf && (
                  <Link to={`/documents/${j.result.documentId}`} onClick={closeUpload} className="shrink-0 text-sm text-yellow hover:underline">
                    Open →
                  </Link>
                )}
                {j.result?.duplicateOf && (
                  <Link to={`/documents/${j.result.duplicateOf.id}`} onClick={closeUpload} className="shrink-0 text-sm text-yellow hover:underline">
                    Open existing →
                  </Link>
                )}
              </div>
              <Pipeline job={j} />
              {j.error && (
                <p className="mt-2 flex items-start gap-2 text-sm text-[#ff8a95]">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {j.error}
                </p>
              )}
              {j.result && !j.result.duplicateOf && (
                <p className="mt-2 text-sm text-muted">
                  <span className="text-ink">{j.result.fieldsExtracted}</span> fields extracted, <span className="text-ink">{j.result.fieldsDiscarded}</span> discarded for missing evidence · {j.result.anomalies} anomal{j.result.anomalies === 1 ? 'y' : 'ies'} · trust <span className="text-ink">{j.result.trust ?? '–'}</span> · {j.result.engine === 'rules' ? 'rules engine' : j.result.engine}
                  {j.result.masked > 0 && ` · ${j.result.masked} values masked`}
                </p>
              )}
              {j.result?.tamperWarning && (
                <p className="mt-2 flex items-start gap-2 rounded-md bg-missing/10 p-2 text-sm text-[#ffb877]">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0" /> {j.result.tamperWarning}
                </p>
              )}
              {j.result?.duplicateOf && <p className="mt-2 text-sm text-muted">This exact file (same SHA-256) is already in your library, so it was not processed again.</p>}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6">
        <p className="label mb-2 flex items-center gap-1.5">
          <Sparkles className="size-3.5" /> No files handy? Try a sample
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {UPLOAD_SAMPLES.map((s) => (
            <button key={s.key} type="button" disabled={busy} onClick={() => void runSample(s.key)} className="rounded-lg border border-line p-3 text-left transition-colors hover:border-line-2 hover:bg-white/[0.02] disabled:opacity-50">
              <p className="text-sm font-medium">{s.title}</p>
              <p className="mt-0.5 text-xs text-muted">{s.description}</p>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function Pipeline({ job }: { job: Job }) {
  const current = job.stage === 'queued' ? -1 : STAGES.findIndex((s) => s.id === job.stage);
  return (
    <ol className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2" aria-label="Processing steps">
      {STAGES.map((s, i) => {
        const done = i < current || (job.stage === 'done' && !job.error);
        const active = i === current && job.stage !== 'done' && !job.error;
        const failed = Boolean(job.error) && i === Math.max(0, current);
        return (
          <li key={s.id} className="flex items-center gap-1">
            <span className={cx('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs', done ? 'bg-amount/15 text-amount' : active ? 'bg-yellow/15 text-yellow' : failed ? 'bg-anomaly/15 text-[#ff8a95]' : 'bg-white/5 text-faint')}>
              {done ? <Check className="size-3" /> : active ? <Loader2 className="size-3 animate-spin" /> : failed ? <AlertTriangle className="size-3" /> : null}
              {s.label}
              {active && job.detail && <span className="text-yellow/70">· {job.detail}</span>}
            </span>
            {i < STAGES.length - 1 && <span className="h-px w-3 bg-line-2" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
