import { CalendarPlus, CheckCircle2, Circle, Repeat } from 'lucide-react';
import { useSession } from '@/app/auth';
import { useToast } from '@/app/toast';
import { formatDate } from '@/lib/engine/dates';
import { buildICS } from '@/lib/engine/ics';
import { formatINR } from '@/lib/engine/money';
import { effectiveDueDate, effectiveStatus } from '@/lib/engine/obligations';
import { downloadBlob } from '@/lib/report';
import type { Obligation } from '@/lib/types';
import { Button, Cite, cx, EmptyState } from '../ui';
import { PenaltyCalculator } from './PenaltyCalculator';

const STATUS: Record<Obligation['status'], string> = {
  upcoming: 'bg-obligation/15 text-[#86c3ff]',
  overdue: 'bg-anomaly/15 text-[#ff8a95]',
  done: 'bg-amount/15 text-amount',
};

export function ObligationsTab({ obligations, fileName, activeId, onLocate, onChanged }: { obligations: Obligation[]; fileName: string; activeId: string | null; onLocate: (id: string) => void; onChanged: () => void }) {
  const { repo } = useSession();
  const toast = useToast();
  if (!obligations.length) return <EmptyState title="No obligations found" body="No sentence in this document assigns a duty to a party." />;

  const sorted = [...obligations].sort((a, b) => (effectiveDueDate(a) ?? '9999').localeCompare(effectiveDueDate(b) ?? '9999'));

  const toggle = async (o: Obligation) => {
    const status = o.status === 'done' ? 'upcoming' : 'done';
    try {
      await repo.updateObligation(o.id, { status });
      await repo.log('obligation', { action: status === 'done' ? 'marked done' : 'reopened', party: o.party, task: o.action }, o.document_id);
      toast.success(status === 'done' ? 'Marked as done' : 'Reopened', o.action);
      onChanged();
    } catch (err) {
      toast.error('Could not update the obligation', (err as Error).message);
    }
  };

  const exportOne = (o: Obligation) => {
    const date = effectiveDueDate(o);
    if (!date) return;
    const ics = buildICS([{ uid: o.id, date, title: `${o.party}: ${o.action}`.slice(0, 140), description: `${fileName} p.${o.page} · L${o.line}\n“${o.source_text ?? ''}”${o.penalty_text ? `\nPenalty: ${o.penalty_text}` : ''}`, recurrence: o.recurrence }]);
    downloadBlob(new Blob([ics], { type: 'text/calendar' }), `deadline-${date}.ics`);
    toast.success('Calendar file downloaded', 'Open it, or import it in Google Calendar → Settings → Import.');
  };

  return (
    <ul className="space-y-2.5">
      {sorted.map((o) => {
        const due = effectiveDueDate(o);
        const status = effectiveStatus(o);
        return (
          <li key={o.id} id={`card-ob:${o.id}`} className={cx('card scroll-mt-24 p-3.5', activeId === `ob:${o.id}` && 'border-obligation/60')}>
            <div className="flex items-start gap-3">
              <button type="button" onClick={() => void toggle(o)} className="mt-0.5 text-faint hover:text-amount" aria-label={o.status === 'done' ? 'Mark as not done' : 'Mark as done'} title={o.status === 'done' ? 'Mark as not done' : 'Mark as done'}>
                {o.status === 'done' ? <CheckCircle2 className="size-5 text-amount" /> : <Circle className="size-5" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm">
                    <span className="font-semibold text-[#86c3ff]">{o.party}</span> <span className={cx(o.status === 'done' && 'text-muted line-through')}>must {o.action.charAt(0).toLowerCase() + o.action.slice(1)}</span>
                  </p>
                  <Cite page={o.page} line={o.line} onClick={o.page ? () => onLocate(`ob:${o.id}`) : undefined} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className={cx('rounded px-1.5 py-0.5 font-medium capitalize', STATUS[status])}>{status}</span>
                  <span className="text-muted">{due ? `Due ${formatDate(due)}` : 'No fixed date'}</span>
                  {o.recurrence && (
                    <span className="flex items-center gap-1 text-muted">
                      <Repeat className="size-3" /> {o.recurrence}
                    </span>
                  )}
                  {o.amount != null && <span className="text-muted">{formatINR(o.amount)}</span>}
                  {due && (
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={() => exportOne(o)}>
                      <CalendarPlus className="size-3.5" /> .ics
                    </Button>
                  )}
                </div>
                {o.penalty_text && (
                  <p className="mt-2 text-xs text-[#ffb877]">
                    Penalty: {o.penalty_text}
                    {o.penalty_amount != null && ` (≈ ${formatINR(o.penalty_amount)} per month of delay)`}
                  </p>
                )}
                {o.penalty_text && <PenaltyCalculator penaltyText={o.penalty_text} dueDate={due} amount={o.amount} />}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
