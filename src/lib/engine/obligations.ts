// Obligations: who must do what, by when, and what happens if they don't.

import type { Obligation } from '../types';
import { addDays, findDates, formatDate, nextDayOfMonth, shiftByDuration, toISO, todayUTC } from './dates';
import { isPartySubject, type Facts, type LateFee } from './facts';
import { formatINR, findCurrencyAmounts } from './money';

export type ObligationDraft = Omit<Obligation, 'id' | 'document_id' | 'extraction_id' | 'bbox'> & { lineId: string; quote: string };

const MODAL = /\b(shall(?:\s+not)?|must(?:\s+not)?|agrees?\s+to|is\s+required\s+to|undertakes?\s+to|will\s+be\s+responsible\s+for|is\s+responsible\s+for)\b/i;

/** Penalty for one month of delay on `amount`, used as a headline number. */
export function monthlyPenalty(fee: LateFee | undefined, amount: number | null): number | null {
  if (!fee || !amount) return null;
  if (fee.kind === 'percent_month') return Math.round(amount * fee.rate) / 100;
  if (fee.kind === 'percent_year') return Math.round((amount * fee.rate) / 12) / 100;
  return fee.rate * 30;
}

/** Build a map of defined terms ("Client", "Service Provider") to party names. */
function partyAliases(f: Facts): Array<{ alias: string; name: string }> {
  const out: Array<{ alias: string; name: string }> = [];
  for (const line of f.lines.slice(0, 15)) {
    for (const m of line.text.matchAll(/([A-Z][\w&.]*(?:\s+[A-Z][\w&.]*){0,4})\s*\(\s*["“]([^"”]+)["”]\s*\)/g)) {
      out.push({ alias: m[2], name: m[1].replace(/^(?:between|and)\s+/i, '').trim() });
    }
  }
  for (const p of f.parties) {
    const first = p.value.split(/\s+/)[0];
    out.push({ alias: first, name: p.value }, { alias: p.value, name: p.value });
  }
  return out;
}

export function extractObligations(f: Facts, now = new Date()): ObligationDraft[] {
  const out: ObligationDraft[] = [];
  const today = todayUTC(now);
  const money = (v: number | null) => (v == null ? '' : formatINR(v, f.currency));
  const status = (due: Date | null): Obligation['status'] => (due && due < today ? 'overdue' : 'upcoming');
  const base = (line: Facts['lines'][number], quote: string) => ({ page: line.page, line: line.line, source_text: quote, lineId: line.id, quote });

  if (f.docType === 'invoice' && (f.dueDate || f.total)) {
    const due = f.dueDate?.value ?? (f.invoiceDate && f.paymentTerms ? shiftByDuration(f.invoiceDate.value, f.paymentTerms.value) : null);
    const where = f.dueDate ?? f.paymentTerms ?? f.total!;
    out.push({
      party: f.buyer?.value ?? 'Buyer',
      action: `Pay invoice ${f.invoiceNumber?.value ?? ''}${f.total ? ` (${money(f.total.value)})` : ''} to ${f.supplier?.value ?? 'the supplier'}`.replace(/\s+/g, ' '),
      due_date: toISO(due),
      recurrence: null,
      penalty_text: f.lateFee?.line.text.trim() ?? null,
      penalty_amount: monthlyPenalty(f.lateFee?.value, f.total?.value ?? null),
      amount: f.total?.value ?? null,
      status: status(due),
      ...base(where.line, where.quote),
    });
  }

  if (f.docType === 'purchase_order') {
    if (f.deliveryDate) {
      out.push({
        party: f.supplier?.value ?? 'Vendor',
        action: `Deliver the goods ordered on ${f.poNumber?.value ?? 'this PO'}${f.deliveryAddress ? ` to ${f.deliveryAddress.value}` : ''}`,
        due_date: toISO(f.deliveryDate.value),
        recurrence: null,
        penalty_text: f.lateFee?.line.text.trim() ?? null,
        penalty_amount: null,
        amount: null,
        status: status(f.deliveryDate.value),
        ...base(f.deliveryDate.line, f.deliveryDate.quote),
      });
    }
    if (f.paymentTerms) {
      out.push({
        party: f.buyer?.value ?? 'Buyer',
        action: `Pay ${f.supplier?.value ?? 'the vendor'} within ${f.paymentTerms.value.amount} ${f.paymentTerms.value.unit}s of a valid invoice`,
        due_date: null,
        recurrence: null,
        penalty_text: null,
        penalty_amount: null,
        amount: f.total?.value ?? null,
        status: 'upcoming',
        ...base(f.paymentTerms.line, f.paymentTerms.quote),
      });
    }
  }

  if (f.docType === 'contract' || f.docType === 'other') {
    const aliases = partyAliases(f);
    const resolve = (subject: string) => {
      const s = subject.replace(/^(?:the|each|either|both)\s+/i, '').trim();
      const hit = aliases.find((a) => s.toLowerCase().endsWith(a.alias.toLowerCase()) || s.toLowerCase() === a.name.toLowerCase());
      if (/^(?:either|each|both)\b/i.test(subject)) return subject.split(/\s+/).slice(0, 2).join(' ');
      return hit?.name ?? s;
    };
    for (const line of f.lines) {
      const m = MODAL.exec(line.text);
      if (!m || m.index == null) continue;
      const text = line.text.replace(/^\s*(?:clause\s+)?\d+(?:\.\d+)*[.)]?\s+/i, '').trim();
      const offset = line.text.indexOf(text);
      const subjectRaw = line.text.slice(offset, m.index).trim();
      // Only real parties have duties; "This Agreement shall be governed..." is not an obligation.
      if (!isPartySubject(subjectRaw)) continue;
      const party = resolve(subjectRaw);
      const action = text.slice(text.toLowerCase().indexOf(m[1].toLowerCase()) + m[1].length).trim().replace(/[.;]$/, '');
      if (action.length < 6) continue;

      let due: Date | null = findDates(line.text)[0]?.date ?? null;
      let recurrence: Obligation['recurrence'] = null;
      const dom = /\bby\s+the\s+(\d{1,2})(?:st|nd|rd|th)\s+(?:day\s+)?of\s+(?:each|every)\s+month\b/i.exec(line.text);
      if (dom) {
        recurrence = 'monthly';
        due = nextDayOfMonth(Number(dom[1]), today);
      } else if (/\b(?:per|each|every)\s+quarter\b|\bquarterly\b/i.test(line.text)) recurrence = 'quarterly';
      else if (/\b(?:each|every)\s+month\b|\bmonthly\b/i.test(line.text)) recurrence = 'monthly';

      const amounts = findCurrencyAmounts(line.text);
      const amount = amounts[0]?.value ?? null;
      const isPayment = /\b(?:pay|paid|payment)\b/i.test(line.text);
      out.push({
        party,
        action: action.charAt(0).toUpperCase() + action.slice(1),
        due_date: toISO(due),
        recurrence,
        penalty_text: isPayment && f.lateFee ? f.lateFee.line.text.replace(/^\s*\d+(?:\.\d+)*\s+/, '').trim() : null,
        penalty_amount: isPayment ? monthlyPenalty(f.lateFee?.value, amount) : null,
        amount,
        status: status(due),
        ...base(line, text),
      });
    }

    // The notice deadline that stops an auto-renewal is the obligation people miss most.
    const anchor = f.renewalDate ?? f.endDate;
    if (anchor && f.noticeClause) {
      const due = shiftByDuration(anchor.value, f.noticeClause.value, -1);
      out.push({
        party: 'Either party',
        action: f.autoRenewal
          ? `Send written notice to stop the automatic renewal on ${formatDate(anchor.value)}`
          : `Send written notice before the agreement ends on ${formatDate(anchor.value)}`,
        due_date: toISO(due),
        recurrence: null,
        penalty_text: f.autoRenewal ? 'Missing it renews the agreement for another term.' : null,
        penalty_amount: null,
        amount: null,
        status: status(due),
        ...base(f.noticeClause.line, f.noticeClause.quote),
      });
    }
  }
  return out;
}

/** For recurring obligations, roll a past due date forward to the next occurrence. */
export function effectiveDueDate(o: Pick<Obligation, 'due_date' | 'recurrence'>, now = new Date()): string | null {
  if (!o.due_date || !o.recurrence) return o.due_date;
  const today = todayUTC(now);
  let d = new Date(`${o.due_date}T00:00:00Z`);
  const months = o.recurrence === 'monthly' ? 1 : o.recurrence === 'quarterly' ? 3 : 12;
  for (let i = 0; i < 240 && d < today; i += 1) d = shiftByDuration(d, { amount: months, unit: 'month' });
  return toISO(d);
}

export function effectiveStatus(o: Pick<Obligation, 'due_date' | 'recurrence' | 'status'>, now = new Date()): Obligation['status'] {
  if (o.status === 'done') return 'done';
  const due = effectiveDueDate(o, now);
  if (!due) return 'upcoming';
  return due < toISO(todayUTC(now))! ? 'overdue' : 'upcoming';
}

export function inNextDays(due: string | null, days: number, now = new Date()): boolean {
  if (!due) return false;
  const today = toISO(todayUTC(now))!;
  const end = toISO(addDays(todayUTC(now), days))!;
  return due >= today && due <= end;
}
