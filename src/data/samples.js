// Sample documents for the live demo. They are fictional, and each one hides
// problems the engine should catch, so the demo shows every layer of checks.

const invoice0423 = `TAX INVOICE
Apex Cloud Solutions Pvt Ltd
Supplier: Apex Cloud Solutions Pvt Ltd
Supplier GSTIN: 29AABCA1234F1Z5
42, Residency Road, Bengaluru, Karnataka 560025
Invoice No: INV-0423
Invoice Date: 15 Sep 2026
Due Date: Pay by 15 Oct 2026
Bill To: Binary Retail Pvt Ltd
Buyer GSTIN: 29AADCB5678K1Z3
Place of supply: Karnataka
--- Page 2 ---
#  Description               HSN/SAC   Qty        Rate      Amount
1  Cloud hosting (annual)    998315      1 2,40,000.00 2,40,000.00
2  Technical support hours   998313     50    2,500.00 1,25,000.00
3  SSL certificates          998319      5    6,300.00   31,500.00

Sub Total                                              4,08,900.00
CGST @ 9%                                                36,801.00
SGST @ 9%                                                36,801.00
Round off                                                 (-) 2.00
Total Amount (INR)                                    ₹4,82,500.00
Amount in words: Rupees Four Lakh Eighty Two Thousand Five Hundred Only

Payment terms: NEFT to HDFC Bank, IFSC HDFC0000123
For Apex Cloud Solutions Pvt Ltd
Authorised Signatory`;

const invoice0398 = `TAX INVOICE
Supplier: Apex Cloud Solutions Pvt Ltd
Supplier GSTIN: 29AABCA1234F1Z5
Invoice No: INV-0398
Invoice Date: 12 Aug 2026
Due Date: 11 Sep 2026
PO Number: PO-7781
Bill To: Binary Retail Pvt Ltd
Buyer GSTIN: 29AADCB5678K1Z3

#  Description               HSN/SAC   Qty        Rate      Amount
1  Technical support hours   998313     40    2,200.00   88,000.00
2  Backup storage (TB-month) 998315     10    1,500.00   15,000.00

Sub Total                                              1,03,000.00
CGST @ 9%                                                 9,270.00
SGST @ 9%                                                 9,270.00
Total Amount (INR)                                    ₹1,21,540.00
Amount in words: Rupees One Lakh Twenty One Thousand Five Hundred Forty Only

For Apex Cloud Solutions Pvt Ltd
Authorised Signatory`;

const invoice0398Resent = `TAX INVOICE
Supplier: Apex Cloud Solutions Pvt Ltd
Supplier GSTIN: 29AABCA1234F1Z8
Invoice No: INV-0398
Invoice Date: 20 Sep 2026
Due Date: 10 Sep 2026
PO Number: PO-7781
Bill To: Binary Retail Pvt Ltd

#  Description               HSN/SAC   Qty        Rate      Amount
1  Technical support hours   998313     40    2,200.00   88,000.00
2  Backup storage (TB-month) 998315     10    1,500.00   15,000.00

Sub Total                                              1,03,000.00
CGST @ 9%                                                 9,270.00
SGST @ 9%                                                 9,270.00
Total Amount (INR)                                    ₹1,21,540.00
Amount in words: Rupees One Lakh Twelve Thousand Five Hundred Forty Only

For Apex Cloud Services Ltd`;

const msaVendor = `MASTER SERVICES AGREEMENT
This Master Services Agreement is entered into on 1 April 2026 (the "Effective Date") between Binary Retail Pvt Ltd ("Client") and Apex Cloud Solutions Pvt Ltd ("Vendor").

1. SCOPE
1.1 The Vendor shall provide cloud hosting, maintenance and technical support services described in Schedule A.
2. FEES
2.1 Technical support shall be charged at a rate of ₹2,200 per hour.
2.2 Cloud hosting fees are ₹2,40,000 per year, payable annually in advance.
3. OBLIGATIONS
3.1 The Client shall provide timely access to the systems and data required for the services.
3.2 The Vendor must maintain 99.5% monthly uptime and report every incident within 24 hours.
4. LIABILITY
4.1 The Client shall indemnify the Vendor against third-party claims arising from Client data.
4.2 The Vendor's liability shall not be limited for breaches of data protection obligations.
5. LATE PAYMENT
5.1 Late payments shall attract interest at 1.5% per month on the outstanding amount.
--- Page 2 ---
7. TERM AND RENEWAL
7.1 This Agreement shall renew automatically for successive one-year terms commencing 1 April 2027.
7.2 Either party may terminate this Agreement by giving sixty (60) days’ written notice prior to the renewal date.
7.3 All undisputed invoices shall be payable within thirty (30) days of receipt.
8. GOVERNING LAW
8.1 This Agreement shall be governed by the laws of India and subject to the courts of Bengaluru.

IN WITNESS WHEREOF the parties have signed this Agreement on the Effective Date.
For Binary Retail Pvt Ltd - Authorised Signatory
For Apex Cloud Solutions Pvt Ltd - Authorised Signatory`;

export const SAMPLES = [
  {
    name: 'invoice_0423.txt',
    kind: 'Invoice',
    blurb: 'Subtotal does not match its line items; PO reference missing; support billed above the contract rate.',
    text: invoice0423,
  },
  {
    name: 'MSA_Vendor.txt',
    kind: 'Contract',
    blurb: 'Auto-renewal, unlimited liability and a 60-day notice window that has to be worked out from the renewal date.',
    text: msaVendor,
  },
  {
    name: 'invoice_0398.txt',
    kind: 'Invoice',
    blurb: 'A clean invoice from the same vendor. The baseline.',
    text: invoice0398,
  },
  {
    name: 'invoice_0398_resent.txt',
    kind: 'Invoice',
    blurb: 'Re-sent duplicate: wrong amount in words, due before issue, bad GSTIN, no signature.',
    text: invoice0398Resent,
  },
];
