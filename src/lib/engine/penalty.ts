// Penalty Calculator: "If paid on [date], penalty = ₹X".

import { daysBetween, fromISO } from './dates';
import type { LateFee } from './facts';
import { findLateFee } from './facts';
import { round2 } from './money';

export interface PenaltyResult {
  daysLate: number;
  periods: number;
  penalty: number;
  totalPayable: number;
  explanation: string;
}

/** Parse a late-fee sentence ("2% per month after the due date"). */
export function parseLateFee(text: string | null | undefined): LateFee | null {
  if (!text) return null;
  const hit = findLateFee([{ id: 'x', page: 1, line: 1, text, bbox: null }]);
  return hit?.value ?? null;
}

export function computePenalty(fee: LateFee, base: number, dueISO: string, payISO: string): PenaltyResult {
  const due = fromISO(dueISO);
  const pay = fromISO(payISO);
  if (!due || !pay || !Number.isFinite(base) || base < 0) {
    return { daysLate: 0, periods: 0, penalty: 0, totalPayable: base || 0, explanation: 'Enter a valid amount and dates.' };
  }
  const daysLate = Math.max(0, daysBetween(due, pay));
  if (!daysLate) return { daysLate: 0, periods: 0, penalty: 0, totalPayable: round2(base), explanation: 'Paid on or before the due date, so no penalty applies.' };

  let periods: number;
  let penalty: number;
  let explanation: string;
  if (fee.kind === 'per_day') {
    periods = daysLate;
    penalty = fee.rate * daysLate;
    explanation = `${daysLate} day${daysLate === 1 ? '' : 's'} × ₹${fee.rate.toLocaleString('en-IN')} per day`;
  } else if (fee.kind === 'percent_month') {
    // "or part thereof" means every started month counts in full; otherwise pro-rata by day.
    periods = fee.partThereof ? Math.ceil(daysLate / 30) : round2(daysLate / 30);
    penalty = (base * fee.rate * periods) / 100;
    explanation = `${fee.rate}% per month × ${periods} month${periods === 1 ? '' : 's'} (${daysLate} days${fee.partThereof ? ', part months count in full' : ' ÷ 30'})`;
  } else {
    periods = round2(daysLate / 365);
    penalty = (base * fee.rate * daysLate) / 36500;
    explanation = `${fee.rate}% per year × ${daysLate}/365 days`;
  }
  penalty = round2(penalty);
  return { daysLate, periods, penalty, totalPayable: round2(base + penalty), explanation };
}
