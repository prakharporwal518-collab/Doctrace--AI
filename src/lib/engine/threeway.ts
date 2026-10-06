// Three-Way Match: Purchase Order vs Invoice vs Delivery Note, line by line.

import type { Citation, Extraction } from '../types';
import { formatINR, moneyEqual } from './money';
import { tokens } from './text';

export interface ItemRef {
  description: string;
  qty: number;
  rate: number;
  amount: number;
  citation: Citation;
}

export interface MatchCell {
  qty: number | null;
  rate: number | null;
  amount: number | null;
  citation: Citation | null;
}

export interface MatchRow {
  key: string;
  description: string;
  po: MatchCell;
  invoice: MatchCell;
  delivery: MatchCell;
  issues: string[];
  /** Money at stake on this row (e.g. rate difference × invoiced qty). */
  exposure: number;
}

const empty: MatchCell = { qty: null, rate: null, amount: null, citation: null };

/** Turn stored line-item extractions back into structured items. */
export function itemsFromExtractions(rows: Extraction[], documentId: string, fileName: string): ItemRef[] {
  const out: ItemRef[] = [];
  for (const r of [...rows].sort((a, b) => a.page - b.page || a.line - b.line)) {
    if (r.category !== 'line_item' || r.reviewer_status === 'rejected' || !r.normalized_value) continue;
    try {
      const v = JSON.parse(r.normalized_value) as { description: string; qty: number; rate: number; amount: number };
      if (typeof v.qty !== 'number' || typeof v.rate !== 'number') continue;
      out.push({ ...v, citation: { page: r.page, line: r.line, bbox: r.bbox, source_text: r.raw_text, document_id: documentId, file_name: fileName } });
    } catch {
      // A corrected value that is not JSON is simply skipped.
    }
  }
  return out;
}

function sim(a: string, b: string): number {
  const x = new Set(tokens(a));
  const y = new Set(tokens(b));
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const t of x) if (y.has(t)) common += 1;
  // The first word ("Laptops", "Monitors") matters most.
  const firstBonus = tokens(a)[0] === tokens(b)[0] ? 0.35 : 0;
  return common / Math.min(x.size, y.size) * 0.65 + firstBonus;
}

function pick(list: ItemRef[], description: string, used: Set<ItemRef>): ItemRef | null {
  let best: ItemRef | null = null;
  let score = 0;
  for (const it of list) {
    if (used.has(it)) continue;
    const s = sim(description, it.description);
    if (s > score) {
      score = s;
      best = it;
    }
  }
  if (best && score >= 0.45) {
    used.add(best);
    return best;
  }
  return null;
}

const cell = (it: ItemRef | null): MatchCell => (it ? { qty: it.qty, rate: it.rate, amount: it.amount, citation: it.citation } : empty);

export function threeWayMatch(po: ItemRef[], invoice: ItemRef[], delivery: ItemRef[], currency = 'INR'): { rows: MatchRow[]; summary: { mismatches: number; exposure: number } } {
  const money = (v: number) => formatINR(v, currency);
  const rows: MatchRow[] = [];
  const usedPo = new Set<ItemRef>();
  const usedDn = new Set<ItemRef>();
  const anchor = invoice.length ? invoice : po;

  for (const base of anchor) {
    const isInvoice = anchor === invoice;
    let p: ItemRef | null = base;
    if (isInvoice) p = pick(po, base.description, usedPo);
    else usedPo.add(base);
    const d = pick(delivery, base.description, usedDn);
    const inv = isInvoice ? base : null;
    rows.push(compare(base.description, p, inv, d, money, delivery.length > 0, po.length > 0));
  }
  for (const p of po) if (!usedPo.has(p)) rows.push(compare(p.description, p, null, pick(delivery, p.description, usedDn), money, delivery.length > 0, true));
  for (const d of delivery) if (!usedDn.has(d)) rows.push(compare(d.description, null, null, d, money, true, po.length > 0));

  const mismatches = rows.filter((r) => r.issues.length).length;
  const exposure = rows.reduce((s, r) => s + r.exposure, 0);
  return { rows, summary: { mismatches, exposure } };
}

function compare(description: string, p: ItemRef | null, i: ItemRef | null, d: ItemRef | null, money: (v: number) => string, hasDn: boolean, hasPo: boolean): MatchRow {
  const issues: string[] = [];
  let exposure = 0;
  if (i && p) {
    if (!moneyEqual(i.rate, p.rate)) {
      exposure += Math.abs(i.rate - p.rate) * i.qty;
      issues.push(`Rate mismatch: PO ${money(p.rate)} vs invoice ${money(i.rate)} (${money(Math.abs(i.rate - p.rate) * i.qty)} ${i.rate > p.rate ? 'over' : 'under'}-billed)`);
    }
    if (i.qty !== p.qty) {
      exposure += Math.abs(i.qty - p.qty) * i.rate;
      issues.push(`Quantity mismatch: ordered ${p.qty}, invoiced ${i.qty}`);
    }
    if (!moneyEqual(i.amount, p.amount) && moneyEqual(i.rate, p.rate) && i.qty === p.qty) issues.push(`Amount mismatch: PO ${money(p.amount)} vs invoice ${money(i.amount)}`);
  }
  if (i && d && i.qty !== d.qty) {
    exposure += Math.max(0, i.qty - d.qty) * i.rate;
    issues.push(`Invoiced ${i.qty} but only ${d.qty} delivered`);
  }
  if (i && !p && hasPo) issues.push('Billed but not on the purchase order');
  if (p && !i && hasPo) issues.push('Ordered but not invoiced');
  if (hasDn && (i || p) && !d) issues.push('Not on the delivery note');
  return { key: `${description}-${Math.random().toString(36).slice(2, 7)}`, description, po: cell(p), invoice: cell(i), delivery: cell(d), issues, exposure };
}
