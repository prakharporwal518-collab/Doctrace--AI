import { Calculator } from 'lucide-react';
import { useMemo, useState } from 'react';
import { fromISO, formatDate, toISO, todayUTC } from '@/lib/engine/dates';
import { formatINR } from '@/lib/engine/money';
import { computePenalty, parseLateFee } from '@/lib/engine/penalty';

/** "If paid on [date], penalty = ₹X" for any late-fee clause. */
export function PenaltyCalculator({ penaltyText, dueDate, amount }: { penaltyText: string; dueDate: string | null; amount: number | null }) {
  const fee = useMemo(() => parseLateFee(penaltyText), [penaltyText]);
  const today = toISO(todayUTC())!;
  const [due, setDue] = useState(dueDate ?? today);
  const [pay, setPay] = useState(() => {
    const d = fromISO(dueDate ?? today)!;
    return toISO(new Date(d.getTime() + 45 * 86400000))!;
  });
  const [base, setBase] = useState(amount ? String(amount) : '');

  if (!fee) return null;
  const n = Number(base.replace(/[^0-9.]/g, ''));
  const r = computePenalty(fee, n, due, pay);
  return (
    <div className="mt-3 rounded-lg border border-line bg-navy-2/70 p-3">
      <p className="label mb-2 flex items-center gap-1.5">
        <Calculator className="size-3.5" /> Penalty calculator
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs text-muted">
          Amount (₹)
          <input className="input mt-1 h-9 py-1" inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} placeholder="150000" />
        </label>
        <label className="text-xs text-muted">
          Due date
          <input type="date" className="input mt-1 h-9 py-1" value={due} onChange={(e) => e.target.value && setDue(e.target.value)} />
        </label>
        <label className="text-xs text-muted">
          If paid on
          <input type="date" className="input mt-1 h-9 py-1" value={pay} onChange={(e) => e.target.value && setPay(e.target.value)} />
        </label>
      </div>
      {n > 0 ? (
        <p className="mt-3 text-sm">
          If paid on <span className="font-semibold">{formatDate(pay)}</span>, penalty = <span className="text-lg font-semibold text-yellow">{formatINR(r.penalty)}</span>
          <span className="block text-xs text-muted">
            {r.explanation}
            {r.daysLate > 0 && ` · total payable ${formatINR(r.totalPayable)}`}
          </span>
        </p>
      ) : (
        <p className="mt-3 text-sm text-muted">Enter the amount to calculate the penalty.</p>
      )}
    </div>
  );
}
