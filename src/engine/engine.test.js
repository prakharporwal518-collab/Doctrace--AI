import { describe, expect, it } from 'vitest';
import { SAMPLES } from '../data/samples.js';
import { analyzeDocuments, quoteMatches, toExportJSON, verifyFindings } from './analyze.js';
import { addMonths, findDates, findDurations, makeDate, shiftByDuration, toISO } from './dates.js';
import { buildDocument, documentFromText, textToPages } from './document.js';
import { classifyDocument, extractLineItems, isValidGSTIN } from './fields.js';
import { findCurrencyAmounts, findNumbers, formatMoney, parseNumber } from './money.js';
import { DocTraceError, csvToDocument, itemsToLines, parseCSV, parseFile, validateFile } from './parsers.js';
import { parseAmountInWords } from './words.js';

const NOW = { now: new Date('2026-09-26T10:00:00Z') };

function runSamples() {
  const docs = SAMPLES.map((s) => documentFromText(s.name, s.text));
  const out = analyzeDocuments(docs, NOW);
  const byName = Object.fromEntries(out.results.map((r) => [r.doc.name, r]));
  return { out, byName };
}

describe('money', () => {
  it('parses Indian and western digit grouping', () => {
    expect(parseNumber('4,82,500.00')).toBe(482500);
    expect(parseNumber('482,500.00')).toBe(482500);
    expect(parseNumber('₹1,21,540')).toBe(121540);
    expect(parseNumber('abc')).toBeNull();
  });

  it('finds currency amounts', () => {
    const found = findCurrencyAmounts('Total ₹4,82,500.00 and Rs. 500/- and $12.50');
    expect(found.map((f) => f.value)).toEqual([482500, 500, 12.5]);
    expect(found.map((f) => f.currency)).toEqual(['INR', 'INR', 'USD']);
  });

  it('does not treat ids, dates or GSTINs as numbers', () => {
    const nums = findNumbers('INV-0423 dated 15/10/2026 GSTIN 29AABCA1234F1Z5 qty 50');
    expect(nums.map((n) => n.value)).toEqual([50]);
  });

  it('formats rupees with Indian grouping', () => {
    expect(formatMoney(482500, 'INR')).toBe('₹4,82,500.00');
    expect(formatMoney(NaN)).toBe('—');
  });
});

describe('amount in words', () => {
  it('handles lakh / crore and paise', () => {
    expect(parseAmountInWords('Rupees Four Lakh Eighty Two Thousand Five Hundred Only')).toBe(482500);
    expect(parseAmountInWords('Rupees One Crore Twenty Lakh Only')).toBe(12000000);
    expect(parseAmountInWords('Rupees Ninety-Nine and Fifty Paise Only')).toBe(99.5);
    expect(parseAmountInWords('One Million Two Hundred Thousand Dollars')).toBe(1200000);
  });

  it('refuses to guess on unknown words', () => {
    expect(parseAmountInWords('Rupees Banana Only')).toBeNull();
    expect(parseAmountInWords('')).toBeNull();
  });
});

describe('dates', () => {
  it('reads common business formats in UTC', () => {
    const iso = (s) => findDates(s).map((d) => d.iso);
    expect(iso('Pay by 15 Oct 2026')).toEqual(['2026-10-15']);
    expect(iso('commencing 1st April, 2027')).toEqual(['2027-04-01']);
    expect(iso('October 15, 2026')).toEqual(['2026-10-15']);
    expect(iso('due 15/10/2026 or 2026-10-20')).toEqual(['2026-10-15', '2026-10-20']);
    expect(iso('US style 10/25/2026')).toEqual(['2026-10-25']);
  });

  it('rejects impossible dates', () => {
    expect(makeDate(2026, 2, 31)).toBeNull();
    expect(findDates('31/02/2026')).toEqual([]);
  });

  it('does date arithmetic without time-zone drift', () => {
    const renewal = makeDate(2027, 4, 1);
    expect(toISO(shiftByDuration(renewal, { amount: 60, unit: 'day' }, -1))).toBe('2027-01-31');
    expect(toISO(addMonths(makeDate(2026, 1, 31), 1))).toBe('2026-02-28');
  });

  it('reads durations written in words and digits', () => {
    const d = findDurations('by giving sixty (60) days’ written notice');
    expect(d[0]).toMatchObject({ amount: 60, unit: 'day' });
    expect(findDurations('within 30 days of receipt')[0]).toMatchObject({ amount: 30, text: '30 days' });
    expect(findDurations('two weeks')[0]).toMatchObject({ amount: 2, unit: 'week' });
  });
});

describe('document model', () => {
  it('splits pages on markers and form feeds', () => {
    expect(textToPages('a\n--- Page 2 ---\nb')).toEqual([['a'], ['b']]);
    expect(textToPages('a\fb')).toEqual([['a'], ['b']]);
    expect(textToPages('')).toEqual([[]]);
  });

  it('gives every line a stable id', () => {
    const doc = documentFromText('x.txt', 'one\ntwo\n--- Page 2 ---\nthree');
    expect(doc.lines.map((l) => l.id)).toEqual(['p1-L1', 'p1-L2', 'p2-L1']);
    expect(doc.byId.get('p2-L1').text).toBe('three');
  });
});

describe('GSTIN', () => {
  it('validates the check digit', () => {
    expect(isValidGSTIN('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGSTIN('29AABCA1234F1Z5')).toBe(true);
    expect(isValidGSTIN('29AABCA1234F1Z8')).toBe(false);
    expect(isValidGSTIN('not-a-gstin')).toBe(false);
  });
});

describe('parsers', () => {
  it('parses CSV with quotes and commas inside fields', () => {
    expect(parseCSV('a,"b, c","say ""hi"""\n1,2,3')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
    const doc = csvToDocument('t.csv', 'Item,Qty,Rate,Amount\nWidget,2,"1,000.00","2,000.00"');
    expect(extractLineItems(doc)[0]).toMatchObject({ description: 'Widget', qty: 2, rate: 1000, amount: 2000 });
  });

  it('groups PDF text items into lines', () => {
    const items = [
      { str: 'Total', transform: [1, 0, 0, 10, 50, 700], width: 25, height: 10 },
      { str: '₹4,82,500.00', transform: [1, 0, 0, 10, 400, 700.5], width: 60, height: 10 },
      { str: 'Header', transform: [1, 0, 0, 10, 50, 750], width: 30, height: 10 },
    ];
    const lines = itemsToLines(items);
    expect(lines[0]).toBe('Header');
    expect(lines[1]).toMatch(/^Total\s{2,}₹4,82,500\.00$/);
  });

  it('rejects files we cannot read, with a helpful message', () => {
    expect(() => validateFile({ name: 'photo.jpg', size: 10, type: 'image/jpeg' })).toThrow(/OCR/);
    expect(() => validateFile({ name: 'old.doc', size: 10 })).toThrow(/docx/);
    expect(() => validateFile({ name: 'a.txt', size: 0 })).toThrow(/empty/);
    expect(() => validateFile({ name: 'a.pdf', size: 99 * 1024 * 1024 })).toThrow(/limit/);
    expect(() => validateFile({ name: 'a.exe', size: 10 })).toThrow(DocTraceError);
    expect(validateFile({ name: 'a.PDF', size: 10 })).toBe('pdf');
  });

  it('parses a text File end to end', async () => {
    const file = new File(['Invoice No: INV-1\nTotal ₹100'], 'inv.txt', { type: 'text/plain' });
    const doc = await parseFile(file);
    expect(doc.name).toBe('inv.txt');
    expect(doc.lines).toHaveLength(2);
  });

  it('refuses a whitespace-only file', async () => {
    const file = new File(['   \n\n  '], 'blank.txt', { type: 'text/plain' });
    await expect(parseFile(file)).rejects.toThrow(/No readable text/);
  });
});

describe('classification', () => {
  it('tells invoices from contracts', () => {
    const [inv, msa] = SAMPLES;
    expect(classifyDocument(documentFromText(inv.name, inv.text)).type).toBe('invoice');
    expect(classifyDocument(documentFromText(msa.name, msa.text)).type).toBe('contract');
    expect(classifyDocument(documentFromText('x', 'hello world')).type).toBe('other');
  });
});

describe('analysis of the sample documents', () => {
  const { out, byName } = runSamples();
  const labels = (name) => byName[name].findings.map((f) => f.label);

  it('runs without errors and verifies every finding', () => {
    expect(out.errors).toEqual([]);
    expect(out.stats.rejected).toBe(0);
    expect(out.stats.documents).toBe(4);
  });

  it('catches the ₹12,400 gap and the missing PO in invoice_0423', () => {
    const l = labels('invoice_0423.txt');
    expect(l).toContain('Subtotal ≠ Σ line items (₹12,400.00 gap)');
    expect(l).toContain('PO reference missing');
    const gap = byName['invoice_0423.txt'].findings.find((f) => f.label.startsWith('Subtotal'));
    expect(gap.source).toMatchObject({ page: 2, quote: '4,08,900.00' });
  });

  it('flags support billed above the contract rate', () => {
    const f = byName['invoice_0423.txt'].findings.find((x) => x.label.startsWith('Invoice rate ≠ contract rate'));
    expect(f).toBeTruthy();
    expect(f.derived).toContain('₹15,000.00');
    expect(f.related[0].file).toBe('MSA_Vendor.txt');
  });

  it('derives the termination-notice deadline from the renewal date', () => {
    const f = byName['MSA_Vendor.txt'].findings.find((x) => x.label === 'Termination notice due');
    expect(f.date).toBe('2027-01-31');
    expect(f.derived).toBe('renewal 2027-04-01 − 60 days');
    expect(f.source).toMatchObject({ page: 2, clause: '7.2', quote: 'sixty (60) days' });
    expect(toExportJSON(f)).toMatchObject({ type: 'deadline', value: '2027-01-31', source: { clause: '7.2' } });
  });

  it('spots unusual contract clauses', () => {
    const l = labels('MSA_Vendor.txt');
    expect(l).toContain('Unusual clause: auto-renewal clause');
    expect(l).toContain('Unusual clause: unlimited liability');
    expect(byName['MSA_Vendor.txt'].findings.some((f) => f.type === 'obligation')).toBe(true);
  });

  it('keeps the clean invoice clean', () => {
    const anomalies = byName['invoice_0398.txt'].findings.filter((f) => f.type === 'anomaly' || f.type === 'missing');
    expect(anomalies).toEqual([]);
  });

  it('finds every problem in the re-sent duplicate', () => {
    const l = labels('invoice_0398_resent.txt');
    expect(l).toContain('Duplicate of invoice INV-0398 (invoice_0398.txt)');
    expect(l).toContain('Due date is earlier than invoice date');
    expect(l).toContain('Amount in words ≠ figures');
    expect(l).toContain('GSTIN 29AABCA1234F1Z8 fails its check digit');
    expect(l).toContain('Authorised signature missing');
    expect(l).toContain('Party name differs across the document');
  });

  it('gives every finding a citation that exists in the document', () => {
    for (const r of out.results) {
      for (const f of r.findings) {
        if (f.source.schema) continue;
        const line = r.doc.byId.get(f.source.lineId);
        expect(line, f.label).toBeTruthy();
        expect(quoteMatches(f.source.quote, line.text), f.label).toBe(true);
      }
    }
  });
});

describe('verification: no source, no output', () => {
  it('rejects a finding whose quote is not in the cited line', () => {
    const doc = documentFromText('a.txt', 'Payment due 15 Oct 2026');
    const good = { type: 'deadline', source: { docId: doc.id, lineId: 'p1-L1', quote: '15 Oct 2026' } };
    const invented = { type: 'deadline', source: { docId: doc.id, lineId: 'p1-L1', quote: '30 Nov 2026' } };
    const ghost = { type: 'deadline', source: { docId: doc.id, lineId: 'p9-L9', quote: 'x' } };
    const none = { type: 'deadline' };
    const { accepted, rejected } = verifyFindings([good, invented, ghost, none], [doc]);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(3);
  });
});

describe('robustness', () => {
  it('handles empty and odd documents without throwing', () => {
    const docs = [
      buildDocument('empty.txt', [[]]),
      documentFromText('noise.txt', '%%%% ₹ ,,, 99/99/9999 Total: \n\n INVOICE No: ??'),
      documentFromText('huge-number.txt', 'Invoice No: X-1\nTotal ₹99999999999999999999'),
    ];
    const out = analyzeDocuments(docs, NOW);
    expect(out.errors).toEqual([]);
    expect(out.results).toHaveLength(3);
  });

  it('reports a crash in one document without losing the rest', () => {
    const bad = documentFromText('bad.txt', 'Invoice No: INV-9');
    Object.defineProperty(bad, 'lines', { get() { throw new Error('boom'); } });
    const good = documentFromText('good.txt', 'Invoice No: INV-1\nTotal ₹100');
    const out = analyzeDocuments([bad, good], NOW);
    expect(out.errors[0]).toMatchObject({ file: 'bad.txt' });
    expect(out.results.map((r) => r.doc.name)).toEqual(['good.txt']);
  });
});
