// Sample documents for the demo account. All names, GSTINs and numbers are fictional.
// Line numbers matter: the seed spec cites e.g. invoice p.1 · L3 and p.2 · L18,
// so every non-empty row below is one numbered line in the generated PDF.

export type Style = 'title' | 'h' | 'body' | 'b' | 'small' | 'footer';

export interface Cell {
  text: string;
  x: number; // points from the left margin
  align?: 'left' | 'right';
}

export type Row =
  | { kind: 'text'; text: string; style?: Style; gap?: number; box?: boolean }
  | { kind: 'cols'; cells: Cell[]; style?: Style; gap?: number; ruleAbove?: boolean; ruleBelow?: boolean };

export interface SampleDoc {
  key: string;
  fileName: string;
  title: string;
  description: string;
  pages: Row[][];
}

const W = 483; // content width on A4 with 56pt margins
const t = (text: string, style: Style = 'body', gap = 0, box = false): Row => ({ kind: 'text', text, style, gap, box });
const two = (left: string, right: string, style: Style = 'body', gap = 0): Row => ({ kind: 'cols', style, gap, cells: [{ text: left, x: 0 }, { text: right, x: W, align: 'right' }] });
const item = (n: string, desc: string, qty: string, rate: string, amount: string): Row => ({
  kind: 'cols',
  cells: [{ text: n, x: 0 }, { text: desc, x: 22 }, { text: qty, x: 300, align: 'right' }, { text: rate, x: 392, align: 'right' }, { text: amount, x: W, align: 'right' }],
});
const header = (qty = 'Qty'): Row => ({ ...item('#', 'Description', qty, 'Rate (₹)', 'Amount (₹)'), style: 'b', gap: 4, ruleAbove: true, ruleBelow: true } as Row);
const sum = (label: string, amount: string, style: Style = 'body', gap = 0, ruleAbove = false): Row => ({ kind: 'cols', style, gap, ruleAbove, cells: [{ text: label, x: 230 }, { text: amount, x: W, align: 'right' }] });
const footer = (n: number, of: number): Row => t(`Page ${n} of ${of}`, 'footer');

export const INVOICE_0423: SampleDoc = {
  key: 'invoice',
  fileName: 'invoice_0423.pdf',
  title: 'Invoice INV-0423',
  description: 'Sharma Office Supplies → Nexa Technologies. Total overstated by ₹10,500, CGST + SGST on an inter-state supply, no HSN codes, unsigned.',
  pages: [
    [
      t('TAX INVOICE', 'title'),
      two('Invoice No: INV-0423', 'Invoice Date: 15 Sep 2026', 'body', 6),
      t('Pay by 15 Oct 2026', 'b', 4, true),
      t('Supplier: Sharma Office Supplies Pvt Ltd', 'b', 16),
      t('Supplier GSTIN: 07AAKCS1234M1Z5 · PAN: AAKCS1234M'),
      t('B-14, Okhla Industrial Area Phase II, New Delhi 110020'),
      t('Buyer: Nexa Technologies', 'b', 12),
      t('Buyer GSTIN: 29AAFCN5678Q1ZD'),
      t('4th Floor, Prestige Tech Park, Outer Ring Road, Bengaluru 560103'),
      t('Place of Supply: Karnataka (29)', 'body', 12),
      t('PO Reference: PO-7781'),
      t('Payment terms: Net 30 days from the invoice date.'),
      t('Interest @ 18% per annum will be charged on payments received after the due date.'),
      t('Bank: HDFC Bank · A/c No. 50200012345678 · IFSC HDFC0000456', 'body', 12),
      t('Accounts contact: +91 98110 23456 · accounts@sharmaoffice.in'),
      footer(1, 2),
    ],
    [
      t('TAX INVOICE · INV-0423 (continued)', 'h'),
      t('Delivery details', 'b', 10),
      t('Delivered to: Nexa Technologies, 4th Floor, Prestige Tech Park, Bengaluru 560103'),
      t('Delivery date: 18 Sep 2026'),
      t('Delivery note: DN-5521'),
      t('Mode of transport: Road · Vehicle KA-01-AB-4521'),
      t('Table 1: Line items', 'b', 12),
      header(),
      item('1', 'Laptops – Dell Latitude 5440', '5', '50,000.00', '2,50,000.00'),
      item('2', 'Monitors – 27-inch LED (lot of 5)', '1', '1,25,000.00', '1,25,000.00'),
      item('3', 'Accessories – keyboards and mice', '1', '25,000.00', '25,000.00'),
      sum('Subtotal (taxable value)', '4,00,000.00', 'body', 4, true),
      sum('CGST @ 9%', '36,000.00'),
      sum('SGST @ 9%', '36,000.00'),
      sum('Total GST (18%)', '72,000.00'),
      sum('Round off', '0.00'),
      sum('Freight and insurance', 'Nil'),
      sum('Total amount payable', '₹4,82,500.00', 'b', 2, true),
      t('Amount in words: Rupees Four Lakh Eighty Two Thousand Five Hundred Only', 'body', 6),
      t('Goods once sold will not be taken back. Subject to Delhi jurisdiction.', 'small', 14),
      t('For Sharma Office Supplies Pvt Ltd', 'b', 18),
      footer(2, 2),
    ],
  ],
};

export const SERVICE_AGREEMENT: SampleDoc = {
  key: 'contract',
  fileName: 'service_agreement_nexa.pdf',
  title: 'Service Agreement SA-2026-014',
  description: 'Nexa Technologies × CloudServe Solutions. Monthly uptime reports, quarterly fees with a 2% monthly late fee, auto-renewal on 31 Dec 2026.',
  pages: [
    [
      t('SERVICE AGREEMENT', 'title'),
      t('Agreement No: SA-2026-014', 'body', 4),
      t('This Service Agreement is entered into on 1 January 2026 (the "Effective Date")', 'body', 10),
      t('between Nexa Technologies ("Client") and CloudServe Solutions ("Provider").'),
      t('1. DEFINITIONS', 'h', 14),
      t('1.1 "Services" means the managed cloud hosting described in Schedule A.'),
      t('1.2 "Uptime" means the share of minutes in a month during which the Services are available.'),
      t('2. SCOPE OF SERVICES', 'h', 12),
      t("2.1 The Provider shall host, monitor and back up the Client's production systems."),
      t('2.2 The Provider shall assign a named account manager within 7 days of the Effective Date.'),
      footer(1, 4),
    ],
    [
      t('3. SERVICE LEVELS', 'h'),
      t('3.1 The Provider shall maintain at least 99.9% monthly Uptime for the Services.'),
      t('3.2 CloudServe shall deliver a monthly uptime report to Nexa by the 5th of each month.'),
      t('3.3 If Uptime falls below 99.9%, the Client is entitled to a service credit of 5% of'),
      t('the quarterly fee for that quarter.'),
      t("3.4 Planned maintenance requires 48 hours' written warning to the Client."),
      footer(2, 4),
    ],
    [
      t('4. FEES AND PAYMENT', 'h'),
      t('4.1 Nexa shall pay CloudServe ₹1,50,000 per quarter within 30 days of each invoice.'),
      t('4.2 The Provider shall raise each invoice on the first working day of the quarter.'),
      t('4.3 A late fee of 2% per month applies to any amount unpaid after its due date.'),
      t('4.4 Fees are exclusive of GST, which will be charged at the applicable rate.'),
      t('5. CONFIDENTIALITY', 'h', 12),
      t("5.1 Each party shall keep the other party's confidential information secret."),
      t('5.2 This duty survives termination of the Agreement for three years.'),
      footer(3, 4),
    ],
    [
      t('6. TERM AND RENEWAL', 'h'),
      t('6.1 This Agreement remains in force until 31 December 2026.'),
      t('6.2 It shall renew automatically for a further one-year term on 31 December 2026'),
      t('unless either party gives written notice at least 30 days before the renewal date.'),
      t('7. TERMINATION', 'h', 12),
      t("7.1 Either party may terminate this Agreement for material breach on 30 days' notice."),
      t('8. GOVERNING LAW', 'h', 12),
      t('8.1 This Agreement is governed by the laws of India; courts at Bengaluru have jurisdiction.'),
      t('IN WITNESS WHEREOF the parties have signed this Agreement on the Effective Date.', 'body', 18),
      t('For Nexa Technologies · Authorised Signatory', 'b', 24),
      t('For CloudServe Solutions · Authorised Signatory', 'b', 16),
      footer(4, 4),
    ],
  ],
};

export const PURCHASE_ORDER: SampleDoc = {
  key: 'po',
  fileName: 'purchase_order_PO-7781.pdf',
  title: 'Purchase Order PO-7781',
  description: 'Nexa Technologies → Sharma Office Supplies. Monitors ordered at ₹1,00,000, invoiced at ₹1,25,000. No payment terms.',
  pages: [
    [
      t('PURCHASE ORDER', 'title'),
      two('PO Number: PO-7781', 'PO Date: 02 Sep 2026', 'body', 6),
      t('Buyer: Nexa Technologies', 'b', 14),
      t('Buyer GSTIN: 29AAFCN5678Q1ZD'),
      t('Vendor: Sharma Office Supplies Pvt Ltd', 'b', 10),
      t('Vendor GSTIN: 07AAKCS1234M1Z5'),
      t('Deliver to: 4th Floor, Prestige Tech Park, Outer Ring Road, Bengaluru 560103', 'body', 10),
      t('Delivery by: 20 Sep 2026'),
      header(),
      item('1', 'Laptops – Dell Latitude 5440', '5', '50,000.00', '2,50,000.00'),
      item('2', 'Monitors – 27-inch LED (lot of 5)', '1', '1,00,000.00', '1,00,000.00'),
      item('3', 'Accessories – keyboards and mice', '1', '25,000.00', '25,000.00'),
      sum('Subtotal', '3,75,000.00', 'body', 4, true),
      sum('IGST @ 18%', '67,500.00'),
      sum('Order total', '₹4,42,500.00', 'b', 2, true),
      t('Amount in words: Rupees Four Lakh Forty Two Thousand Five Hundred Only', 'body', 6),
      t('Approved by: R. Iyer, Head of Procurement · Authorised Signatory', 'b', 24),
      footer(1, 1),
    ],
  ],
};

export const DELIVERY_NOTE: SampleDoc = {
  key: 'dn',
  fileName: 'delivery_note_DN-5521.pdf',
  title: 'Delivery Note DN-5521',
  description: 'Goods received against PO-7781. Use it to complete the three-way match.',
  pages: [
    [
      t('DELIVERY NOTE', 'title'),
      two('Delivery Note No: DN-5521', 'Delivery date: 18 Sep 2026', 'body', 6),
      t('PO Reference: PO-7781'),
      t('From: Sharma Office Supplies Pvt Ltd', 'b', 12),
      t('Supplier GSTIN: 07AAKCS1234M1Z5'),
      t('Delivered to: Nexa Technologies, 4th Floor, Prestige Tech Park, Bengaluru 560103'),
      header('Qty delivered'),
      item('1', 'Laptops – Dell Latitude 5440', '5', '50,000.00', '2,50,000.00'),
      item('2', 'Monitors – 27-inch LED (lot of 5)', '1', '1,00,000.00', '1,00,000.00'),
      item('3', 'Accessories – keyboards and mice', '1', '25,000.00', '25,000.00'),
      sum('Value of goods delivered', '₹3,75,000.00', 'b', 4, true),
      t('All items received in good condition.', 'body', 14),
      t('Received by: Anita Rao, Stores, Nexa Technologies · Signature: (signed)', 'body', 6),
      footer(1, 1),
    ],
  ],
};

// Revised contract for the Version Diff demo: shorter payment term, higher late fee, longer notice.
export const SERVICE_AGREEMENT_V2: SampleDoc = {
  ...SERVICE_AGREEMENT,
  key: 'contract_v2',
  fileName: 'service_agreement_nexa_v2.pdf',
  title: 'Service Agreement SA-2026-014 (revised)',
  description: 'Revised draft: payment within 15 days, 3% late fee, 60-day notice.',
  pages: SERVICE_AGREEMENT.pages.map((page) =>
    page.map((row) => {
      if (row.kind !== 'text') return row;
      const text = row.text
        .replace('SERVICE AGREEMENT', 'SERVICE AGREEMENT (REVISED)')
        .replace('within 30 days of each invoice', 'within 15 days of each invoice')
        .replace('late fee of 2% per month', 'late fee of 3% per month')
        .replace('at least 30 days before the renewal date', 'at least 60 days before the renewal date');
      return { ...row, text };
    }),
  ),
};

// Same file name as the seeded invoice, but someone "fixed" the total after upload.
// Uploading it shows the Tamper Check (and the duplicate-invoice rule).
export const INVOICE_0423_EDITED: SampleDoc = {
  ...INVOICE_0423,
  key: 'invoice_edited',
  title: 'Invoice INV-0423 (edited copy)',
  description: 'Same file name as the original, but the total was changed to ₹4,72,000.00 after upload. Triggers the tamper warning.',
  pages: INVOICE_0423.pages.map((page) =>
    page.map((row) => (row.kind === 'cols' ? { ...row, cells: row.cells.map((c) => (c.text === '₹4,82,500.00' ? { ...c, text: '₹4,72,000.00' } : c)) } : row.kind === 'text' ? { ...row, text: row.text.replace('Four Lakh Eighty Two Thousand Five Hundred', 'Four Lakh Seventy Two Thousand') } : row)),
  ),
};

export const SEED_DOCS = [INVOICE_0423, SERVICE_AGREEMENT, PURCHASE_ORDER];
export const EXTRA_SAMPLES = [DELIVERY_NOTE, SERVICE_AGREEMENT_V2, INVOICE_0423_EDITED];
