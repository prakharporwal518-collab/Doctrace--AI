import { Check, History, Pencil, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSession } from '@/app/auth';
import { useToast } from '@/app/toast';
import { KIND } from '@/lib/categories';
import { nowISO, uuid } from '@/lib/id';
import type { Category, Correction, Extraction } from '@/lib/types';
import { Badge, Button, Cite, ConfidenceBar, cx, EmptyState } from '../ui';

const ORDER: Category[] = ['deadline', 'amount', 'obligation', 'party', 'date', 'identifier', 'line_item'];
const STATUS_STYLE: Record<Extraction['reviewer_status'], string> = {
  pending: 'text-faint',
  approved: 'text-amount',
  rejected: 'text-anomaly line-through',
  corrected: 'text-obligation',
};

/** Show the source sentence with the extracted value underlined, when it appears verbatim. */
export function Quote({ text, mark }: { text: string; mark?: string }) {
  const i = mark ? text.toLowerCase().indexOf(mark.toLowerCase()) : -1;
  return (
    <blockquote className="border-l-2 border-line-2 pl-3 font-serif text-[13.5px] leading-snug text-muted">
      “{i < 0 ? text : <>{text.slice(0, i)}<span className="rounded-sm bg-yellow/20 px-0.5 text-ink">{text.slice(i, i + mark!.length)}</span>{text.slice(i + mark!.length)}</>}”
    </blockquote>
  );
}

export function ExtractionsTab({ extractions, corrections, activeId, onLocate, onChanged }: { extractions: Extraction[]; corrections: Correction[]; activeId: string | null; onLocate: (id: string) => void; onChanged: () => void }) {
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const counts = useMemo(() => {
    const c: Partial<Record<Category, number>> = {};
    for (const e of extractions) c[e.category] = (c[e.category] ?? 0) + 1;
    return c;
  }, [extractions]);
  const shown = extractions
    .filter((e) => filter === 'all' || e.category === filter)
    .sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category) || a.page - b.page || a.line - b.line);

  if (!extractions.length) return <EmptyState title="No fields passed the Evidence Lock" body="Nothing in this document could be extracted with a verifiable source line." />;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {(['all', ...ORDER.filter((c) => counts[c])] as const).map((c) => (
          <button key={c} type="button" onClick={() => setFilter(c)} className={cx('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors', filter === c ? 'border-yellow/60 bg-yellow/10 text-ink' : 'border-line text-muted hover:text-ink')}>
            {c !== 'all' && <span className="size-2 rounded-full" style={{ background: KIND[c].color }} />}
            {c === 'all' ? `All ${extractions.length}` : `${KIND[c].label} ${counts[c]}`}
          </button>
        ))}
      </div>
      <ul className="space-y-2.5">
        {shown.map((e) => (
          <ExtractionCard key={e.id} e={e} history={corrections.filter((c) => c.extraction_id === e.id)} active={activeId === `ex:${e.id}`} onLocate={() => onLocate(`ex:${e.id}`)} onChanged={onChanged} />
        ))}
      </ul>
    </div>
  );
}

function ExtractionCard({ e, history, active, onLocate, onChanged }: { e: Extraction; history: Correction[]; active: boolean; onLocate: () => void; onChanged: () => void }) {
  const { repo, profile } = useSession();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(e.value);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const reviewer = profile.role === 'reviewer';
  const color = KIND[e.category].color;

  const act = async (status: Extraction['reviewer_status'], newValue?: string) => {
    setBusy(true);
    try {
      if (newValue != null && newValue !== e.value) {
        await repo.addCorrection({ id: uuid(), extraction_id: e.id, user_id: repo.userId, old_value: e.value, new_value: newValue, created_at: nowISO() });
        await repo.updateExtraction(e.id, { value: newValue, reviewer_status: 'corrected' });
        await repo.log('review', { action: 'corrected', label: e.label, from: e.value, to: newValue, page: e.page, line: e.line }, e.document_id);
        toast.success('Correction saved', `${e.label}: “${e.value}” → “${newValue}”`);
      } else {
        await repo.updateExtraction(e.id, { reviewer_status: status });
        await repo.log('review', { action: status, label: e.label, value: e.value, page: e.page, line: e.line }, e.document_id);
        toast.success(status === 'approved' ? 'Field approved' : status === 'rejected' ? 'Field rejected' : 'Review reset', e.label);
      }
      setEditing(false);
      onChanged();
    } catch (err) {
      toast.error('Could not save the review', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li id={`card-ex:${e.id}`} className={cx('card scroll-mt-24 p-3.5 transition-colors', active && 'border-yellow/60 bg-card-2')} style={{ borderLeftColor: undefined }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs text-muted">
            <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
            {KIND[e.category].label} · {e.label}
          </p>
          {editing ? (
            <form
              className="mt-1.5 flex gap-2"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (draft.trim()) void act('corrected', draft.trim());
              }}
            >
              <input className="input h-9 py-1" value={draft} onChange={(ev) => setDraft(ev.target.value)} autoFocus aria-label="Corrected value" />
              <Button size="sm" variant="primary" type="submit" loading={busy}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <p className={cx('mt-0.5 text-[15px] font-semibold break-words', e.reviewer_status === 'rejected' && 'line-through opacity-60')}>{e.value}</p>
          )}
        </div>
        <Cite page={e.page} line={e.line} onClick={onLocate} className="mt-0.5" />
      </div>
      <div className="mt-2">
        <Quote text={e.raw_text} mark={e.category === 'line_item' ? undefined : e.value.split(' (')[0]} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <ConfidenceBar value={e.confidence} />
          <Badge>{e.source === 'rules' ? 'rules' : e.source}</Badge>
          {e.verified && <span className="text-xs text-amount">✓ evidence verified</span>}
          <span className={cx('text-xs capitalize', STATUS_STYLE[e.reviewer_status])}>{e.reviewer_status}</span>
        </div>
        <div className="flex items-center gap-1" title={reviewer ? undefined : 'Only reviewers can approve, reject or correct fields. Change your role in Settings.'}>
          <Button size="sm" variant="ghost" disabled={!reviewer || busy} onClick={() => act(e.reviewer_status === 'approved' ? 'pending' : 'approved')} aria-label="Approve" className={e.reviewer_status === 'approved' ? 'text-amount' : ''}>
            <Check className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" disabled={!reviewer || busy} onClick={() => act(e.reviewer_status === 'rejected' ? 'pending' : 'rejected')} aria-label="Reject" className={e.reviewer_status === 'rejected' ? 'text-anomaly' : ''}>
            <X className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" disabled={!reviewer || busy} onClick={() => { setDraft(e.value); setEditing(true); }} aria-label="Correct">
            <Pencil className="size-3.5" />
          </Button>
          {history.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setShowHistory((s) => !s)} aria-expanded={showHistory} aria-label="Edit history">
              <History className="size-3.5" /> {history.length}
            </Button>
          )}
        </div>
      </div>
      {showHistory && (
        <ul className="mt-2 space-y-1 border-t border-line pt-2 text-xs text-muted">
          {history.map((c) => (
            <li key={c.id}>
              <span className="text-faint">{new Date(c.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span> · “{c.old_value}” → <span className="text-ink">“{c.new_value}”</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
