import { describe, expect, it } from 'vitest';
import type { FieldCandidate, ParsedDocument } from '../types';
import { detectAnomalies } from './anomalies';
import { addMonths, findDates, findDurations, makeDate, nextDayOfMonth, shiftByDuration, toISO } from './dates';
import { diffContracts, splitClauses } from './diff';
import { evidenceLock, locateQuote } from './evidence';
import { extractFacts } from './facts';
import { buildICS } from './ics';
import { gstinState, isValidGSTIN, isValidPAN, stateFromText } from './ids';
import { checkMissing } from './missing';
import { findCurrencyAmounts, findNumbers, formatINR, parseNumber } from './money';
import { effectiveDueDate, effectiveStatus } from './obligations';
import { computePenalty, parseLateFee } from './penalty';
import { maskSensitive } from './privacy';
import { answerLocally, NOT_FOUND } from './qa';
import { bestWindow, similarity } from './text';
import { threeWayMatch, type ItemRef } from './threeway';
import { trustScore } from './trust';
import { parseAmountInWords } from './words';
import { SERVICE_AGREEMENT, SERVICE_AGREEMENT_V2 } from '../pdfgen/samples';

/** Build a ParsedDocument from plain lines (one array per page). */
function doc(...pages: string[][]): ParsedDocument {
  return {
    source: 'pdf-text',
    pages: pages.map((lines, pi) => ({
      number: pi + 1,
      width: 595,
      height: 842,
      lines: lines.map((text, i) => ({ id: `p${pi + 1}-L${i + 1}`, page: pi + 1, line: i + 1, text, bbox: { x: 0.1, y: 0.05 + i * 0.02, w: 0.8, h: 0.015 } })),
    })),
  };
}

/** Text of a SampleDoc, page by page, as ingest would produce it. */
function sampleDoc(s: typeof SERVICE_AGREEMENT): ParsedDocument {
  return doc(...s.pages.map((rows) => rows.map((r) => (r.kind === 'text' ? r.text : r.cells.map((c) => c.text).join('    ')))));
}

const NOW = new Date('2026-10-06T10:00:00Z');

describe('money and words', () => {
  it('parses Indian and western grouping', () => {
    expect(parseNumber('4,82,500.00')).toBe(482500);
    expect(parseNumber('₹1,21,540')).toBe(121540);
    expect(parseNumber('abc')).toBeNull();
    expect(findCurrencyAmounts('Total ₹4,82,500.00 and Rs. 500/-').map((a) => a.value)).toEqual([482500, 500]);
    expect(findNumbers('INV-0423 on 15/10/2026 GSTIN 29AAFCN5678Q1ZD qty 50').map((n) => n.value)).toEqual([50]);
    expect(formatINR(482500)).toBe('₹4,82,500.00');
  });

  it('reads amounts in words, lakh/crore aware', () => {
    expect(parseAmountInWords('Rupees Four Lakh Eighty Two Thousand Five Hundred Only')).toBe(482500);
    expect(parseAmountInWords('Rupees One Crore Twenty Lakh Only')).toBe(12000000);
    expect(parseAmountInWords('Rupees Ninety-Nine and Fifty Paise Only')).toBe(99.5);
    expect(parseAmountInWords('Rupees Banana Only')).toBeNull();
  });
});

describe('dates', () => {
  it('reads common formats in UTC and rejects impossible dates', () => {
    expect(findDates('Pay by 15 Oct 2026').map((d) => d.iso)).toEqual(['2026-10-15']);
    expect(findDates('on 1st April, 2027 or 2026-10-20').map((d) => d.iso)).toEqual(['2027-04-01', '2026-10-20']);
    expect(findDates('31/02/2026')).toEqual([]);
    expect(toISO(shiftByDuration(makeDate(2026, 12, 31)!, { amount: 30, unit: 'day' }, -1))).toBe('2026-12-01');
    expect(toISO(addMonths(makeDate(2026, 1, 31)!, 1))).toBe('2026-02-28');
    expect(toISO(nextDayOfMonth(5, makeDate(2026, 10, 6)!))).toBe('2026-11-05');
    expect(toISO(nextDayOfMonth(5, makeDate(2026, 10, 5)!))).toBe('2026-10-05');
    expect(findDurations('giving sixty (60) days’ written notice')[0]).toMatchObject({ amount: 60, unit: 'day' });
  });
});

describe('classification', () => {
  it('trusts the title line over words further down', () => {
    expect(extractFacts(doc(['MASTER SERVICES AGREEMENT', 'between A Ltd ("Client") and B Ltd ("Vendor").', '1.1 The Vendor shall deliver within 15 days of each purchase order.'])).docType).toBe('contract');
    expect(extractFacts(doc(['TAX INVOICE', 'PO Reference: PO-1'])).docType).toBe('invoice');
    expect(extractFacts(doc(['DELIVERY NOTE', 'PO Reference: PO-1'])).docType).toBe('delivery_note');
  });
});

describe('identifiers', () => {
  it('validates GSTIN check digits and state codes', () => {
    expect(isValidGSTIN('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGSTIN('07AAKCS1234M1Z5')).toBe(true);
    expect(isValidGSTIN('07AAKCS1234M1Z8')).toBe(false);
    expect(isValidGSTIN('99AAKCS1234M1Z5')).toBe(false);
    expect(gstinState('29AAFCN5678Q1ZD')).toEqual({ code: '29', name: 'Karnataka' });
    expect(stateFromText('Place of Supply: Karnataka (29)')?.code).toBe('29');
  });

  it('validates PAN format including the holder-type letter', () => {
    expect(isValidPAN('AAKCS1234M')).toBe(true);
    expect(isValidPAN('AAKXS1234M')).toBe(false);
    expect(isValidPAN('AAKC1234M')).toBe(false);
  });
});

describe('Evidence Lock', () => {
  const d = doc(['TAX INVOICE', 'Pay by 15 Oct 2026', 'Total amount payable    ₹4,82,500.00'], ['3.3 If Uptime falls below 99.9%, the Client is entitled to a service credit of 5% of', 'the quarterly fee for that quarter.']);
  const base: FieldCandidate = { category: 'amount', label: 'Total', value: '₹4,82,500.00', normalized_value: '482500.00', page: 1, line: 3, source_text: '₹4,82,500.00', confidence: 0.9, origin: 'gemini' };

  it('accepts a quote that is really at the cited line, and boxes it', () => {
    const r = evidenceLock([base], d);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0].bbox).not.toBeNull();
  });

  it('rejects quotes from the wrong line, missing pages and invented text', () => {
    const r = evidenceLock(
      [
        { ...base, line: 2 },
        { ...base, page: 7 },
        { ...base, line: 40 },
        { ...base, source_text: 'Grand total ₹5,00,000.00' },
        { ...base, source_text: '' },
      ],
      d,
    );
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected.map((x) => x.reason)).toEqual([
      expect.stringMatching(/no evidence \(quote not found at p\.1 · L2/),
      expect.stringMatching(/page 7 does not exist/),
      expect.stringMatching(/has no line 40/),
      expect.stringMatching(/no evidence/),
      expect.stringMatching(/no source text/),
    ]);
  });

  it('rejects a real quote paired with a hallucinated value', () => {
    const r = evidenceLock([{ ...base, value: '₹5,00,000.00', normalized_value: '500000.00' }], d);
    expect(r.rejected[0].reason).toMatch(/not in the quoted text/);
  });

  it('tolerates OCR noise and sentences that wrap onto the next line', () => {
    expect(locateQuote(d, 1, 2, 'Pay by 15 0ct 2026').score).toBeGreaterThan(0.86);
    const wrapped = locateQuote(d, 2, 1, 'service credit of 5% of the quarterly fee');
    expect(wrapped.score).toBeGreaterThanOrEqual(0.86);
    expect(wrapped.bbox!.h).toBeGreaterThan(0.015);
  });

  it('measures similarity sensibly', () => {
    expect(similarity('Pay by 15 Oct 2026', 'pay  by 15 oct 2026')).toBe(1);
    expect(bestWindow('Oct 2026', 'Pay by 15 Oct 2026').score).toBe(1);
  });
});

describe('anomaly engine', () => {
  const rules = (d: ParsedDocument) => detectAnomalies(extractFacts(d), d).map((a) => a.rule_code);

  it('flags GST computed at the wrong rate, and amount in words ≠ figures', () => {
    const d = doc(['TAX INVOICE', 'Invoice No: INV-9    Invoice Date: 01 Sep 2026', 'Supplier GSTIN: 29AAHCC4321R1Z6', 'Buyer GSTIN: 29AAFCN5678Q1ZD',
      '1    Widgets    10    100.00    1,000.00', 'Subtotal    1,000.00', 'CGST @ 9%    100.00', 'SGST @ 9%    90.00', 'Total    1,190.00', 'Amount in words: Rupees One Thousand One Hundred Only']);
    const r = rules(d);
    expect(r).toContain('GST_RATE');
    expect(r).toContain('WORDS_MISMATCH');
  });

  it('flags IGST on an intra-state supply, a bad GSTIN, and a due date before the invoice date', () => {
    const d = doc(['TAX INVOICE', 'Invoice No: INV-10    Invoice Date: 20 Sep 2026', 'Due Date: 10 Sep 2026', 'Supplier GSTIN: 29AAHCC4321R1Z9', 'Place of Supply: Karnataka (29)',
      '1    Widgets    1    100.00    100.00', 'Subtotal    100.00', 'IGST @ 18%    18.00', 'Total    118.00']);
    const r = rules(d);
    expect(r).toEqual(expect.arrayContaining(['GSTIN_INVALID', 'DATE_DUE_BEFORE_ISSUE']));
    // Invalid GSTIN has no trustworthy state, so the GST-type rule stays quiet.
    expect(r).not.toContain('GST_INTERSTATE');
  });

  it('flags a malformed PAN and a duplicate invoice number from another document', () => {
    const d = doc(['TAX INVOICE', 'Invoice No: INV-0398', 'PAN: ABCD1234', 'Total    ₹100.00']);
    const f = extractFacts(d);
    const out = detectAnomalies(f, d, { existingInvoices: [{ number: 'INV-0398', document_id: 'x', file_name: 'old.pdf', supplierKey: null }] });
    expect(out.map((a) => a.rule_code)).toEqual(expect.arrayContaining(['PAN_INVALID', 'DUPLICATE_INVOICE']));
    expect(out.find((a) => a.rule_code === 'DUPLICATE_INVOICE')!.title).toContain('old.pdf');
  });

  it('gives every anomaly an explanation, expected/found values and a citation', () => {
    const d = doc(['TAX INVOICE', 'Invoice No: INV-1', '1    Widgets    2    10.00    25.00', 'Subtotal    20.00', 'Total    20.00']);
    for (const a of detectAnomalies(extractFacts(d), d)) {
      expect(a.explanation.length).toBeGreaterThan(20);
      expect(a.page).toBeGreaterThan(0);
      expect(a.source_text).toBeTruthy();
    }
  });
});

describe('missing data, trust and penalties', () => {
  it('scores completeness by severity', () => {
    const d = doc(['TAX INVOICE', 'Invoice No: INV-1    Invoice Date: 01 Sep 2026', 'Total    ₹100.00']);
    const m = checkMissing(extractFacts(d));
    expect(m.schema).toBe('GST tax invoice');
    expect(m.completeness).toBeGreaterThan(0);
    expect(m.completeness).toBeLessThan(60);
    expect(m.checklist.find((c) => c.key === 'place_of_supply')!.present).toBe(false);
  });

  it('computes the trust score with a visible breakdown', () => {
    const t = trustScore({ anomalies: [{ severity: 'high' }, { severity: 'low' }], missing: [{ severity: 'medium' }], confidences: [0.9, 1] });
    expect(t.score).toBe(100 - 15 - 3 - 5 - 2);
    expect(t.parts.map((p) => p.label)).toContain('1 high anomaly');
  });

  it('calculates late-payment penalties', () => {
    const fee = parseLateFee('A late fee of 2% per month applies to any amount unpaid after its due date.')!;
    expect(fee).toEqual({ kind: 'percent_month', rate: 2, partThereof: false });
    expect(computePenalty(fee, 150000, '2026-10-31', '2026-10-31').penalty).toBe(0);
    expect(computePenalty(fee, 150000, '2026-10-31', '2026-11-30').penalty).toBe(3000);
    const yearly = parseLateFee('Interest @ 18% per annum will be charged on payments received after the due date.')!;
    expect(computePenalty(yearly, 482500, '2026-10-15', '2026-11-14').penalty).toBeCloseTo(7138.36, 1);
    const ceil = { ...fee, partThereof: true };
    expect(computePenalty(ceil, 1000, '2026-01-01', '2026-01-02').periods).toBe(1);
  });

  it('rolls recurring obligations forward', () => {
    const o = { due_date: '2026-09-05', recurrence: 'monthly' as const, status: 'upcoming' as const };
    expect(effectiveDueDate(o, NOW)).toBe('2026-11-05');
    expect(effectiveStatus(o, NOW)).toBe('upcoming');
    expect(effectiveStatus({ due_date: '2026-09-20', recurrence: null, status: 'upcoming' }, NOW)).toBe('overdue');
    expect(effectiveStatus({ due_date: '2026-09-20', recurrence: null, status: 'done' }, NOW)).toBe('done');
  });
});

describe('three-way match', () => {
  const c = { page: 1, line: 1, bbox: null, source_text: '' };
  const it3 = (description: string, qty: number, rate: number): ItemRef => ({ description, qty, rate, amount: qty * rate, citation: c });
  it('flags the ₹25,000 monitor rate mismatch and quantity shortfalls', () => {
    const po = [it3('Laptops – Dell Latitude 5440', 5, 50000), it3('Monitors – 27-inch LED (lot of 5)', 1, 100000), it3('Accessories – keyboards and mice', 1, 25000)];
    const inv = [it3('Laptops – Dell Latitude 5440', 5, 50000), it3('Monitors – 27-inch LED (lot of 5)', 1, 125000), it3('Accessories – keyboards and mice', 1, 25000)];
    const dn = [it3('Laptops – Dell Latitude 5440', 4, 50000), it3('Monitors – 27-inch LED (lot of 5)', 1, 100000), it3('Accessories – keyboards and mice', 1, 25000)];
    const r = threeWayMatch(po, inv, dn);
    expect(r.rows).toHaveLength(3);
    const mon = r.rows.find((x) => x.description.startsWith('Monitors'))!;
    expect(mon.issues[0]).toMatch(/Rate mismatch: PO ₹1,00,000.00 vs invoice ₹1,25,000.00 \(₹25,000.00 over-billed\)/);
    expect(r.rows.find((x) => x.description.startsWith('Laptops'))!.issues).toEqual(['Invoiced 5 but only 4 delivered']);
    expect(r.summary).toEqual({ mismatches: 2, exposure: 75000 });
  });
});

describe('contract diff', () => {
  it('summarises the changed terms with citations', () => {
    const { summary, changes } = diffContracts(sampleDoc(SERVICE_AGREEMENT).pages, sampleDoc(SERVICE_AGREEMENT_V2).pages);
    expect(summary).toEqual([
      'Payment term changed from 30 to 15 days (p.3 · L2)',
      'Late fee changed from 2% to 3% (p.3 · L4)',
      'Notice period changed from 30 to 60 days (p.4 · L3)',
    ]);
    expect(changes[0].tokens.some((t) => t.op === 'del' && t.text === '30')).toBe(true);
    expect(splitClauses(sampleDoc(SERVICE_AGREEMENT).pages).find((c) => c.id === '3.3')!.text).toMatch(/quarterly fee for that quarter/);
  });
});

describe('privacy mode', () => {
  it('masks PAN, Aadhaar, bank account, phone and email without changing length', () => {
    const line = 'PAN: AAKCS1234M · Aadhaar 1234 5678 9012 · A/c No. 50200012345678 · +91 98110 23456 · accounts@sharma.in';
    const m = maskSensitive(line);
    expect(m.text).toHaveLength(line.length);
    expect(m.text).not.toContain('AAKCS1234M');
    expect(m.text).not.toContain('50200012345678');
    expect(m.text).not.toMatch(/98110 23456/);
    expect(m.text).toContain('@sharma.in');
    expect(m.counts).toEqual({ pan: 1, aadhaar: 1, bank: 1, phone: 1, email: 1 });
    // GSTINs are public business ids and stay readable.
    expect(maskSensitive('GSTIN 07AAKCS1234M1Z5').text).toBe('GSTIN 07AAKCS1234M1Z5');
  });
});

describe('calendar export', () => {
  it('writes a valid all-day .ics with recurrence and folding', () => {
    const ics = buildICS([{ uid: 'a', date: '2026-12-01', title: 'Notice deadline, SA-2026-014; send letter', description: 'x'.repeat(200), recurrence: 'monthly' }], NOW);
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261201');
    expect(ics).toContain('DTEND;VALUE=DATE:20261202');
    expect(ics).toContain('SUMMARY:Notice deadline\\, SA-2026-014\\; send letter');
    expect(ics).toContain('RRULE:FREQ=MONTHLY');
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
});

describe('Ask-the-Document (offline)', () => {
  const d = sampleDoc(SERVICE_AGREEMENT);
  it('answers with a citation', () => {
    const r = answerLocally('What is the late fee?', d.pages);
    expect(r.found).toBe(true);
    expect(r.citations[0]).toMatchObject({ page: 3, line: 4 });
  });
  it('answers Hindi questions in Hindi', () => {
    const r = answerLocally('नवीनीकरण की तारीख कब है?', d.pages);
    expect(r.found).toBe(true);
    expect(r.answer).toMatch(/[\u0900-\u097F]/);
    expect(r.citations[0].page).toBe(4);
  });
  it('refuses instead of guessing', () => {
    expect(answerLocally('What is the capital of France?', d.pages)).toMatchObject({ found: false, answer: NOT_FOUND.en, citations: [] });
    expect(answerLocally('मौसम कैसा है?', d.pages).answer).toBe(NOT_FOUND.hi);
  });
});
