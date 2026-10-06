// Missing Data Checklist: required fields per document type, and a
// completeness score out of 100.

import type { DocType, Severity } from '../types';
import type { Facts } from './facts';

interface FieldRule {
  key: string;
  label: string;
  why: string;
  severity: Severity;
  present: (f: Facts) => boolean;
}

const W: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

export const SCHEMAS: Partial<Record<DocType, { name: string; fields: FieldRule[] }>> = {
  invoice: {
    name: 'GST tax invoice',
    fields: [
      { key: 'invoice_number', label: 'Invoice number', why: 'Rule 46 of the CGST Rules requires a unique serial number on every tax invoice.', severity: 'high', present: (f) => !!f.invoiceNumber },
      { key: 'invoice_date', label: 'Invoice date', why: 'The date of issue decides the tax period and the payment due date.', severity: 'high', present: (f) => !!f.invoiceDate },
      { key: 'supplier_gstin', label: 'Supplier GSTIN', why: 'Without the supplier’s GSTIN the buyer cannot claim input tax credit.', severity: 'high', present: (f) => !!f.supplierGSTIN },
      { key: 'buyer_gstin', label: 'Buyer GSTIN', why: 'Required on B2B invoices so the sale reflects in the buyer’s GSTR-2B.', severity: 'medium', present: (f) => !!f.buyerGSTIN },
      { key: 'place_of_supply', label: 'Place of supply', why: 'Decides whether IGST or CGST + SGST applies.', severity: 'high', present: (f) => !!f.placeOfSupply },
      { key: 'hsn', label: 'HSN / SAC codes', why: 'HSN or SAC codes are mandatory for each line item on GST invoices above the turnover threshold.', severity: 'medium', present: (f) => !!f.hsn },
      { key: 'signature', label: 'Authorised signature', why: 'An invoice must be signed (or digitally signed) by the supplier or an authorised representative.', severity: 'medium', present: (f) => !!f.signature },
      { key: 'total', label: 'Invoice total', why: 'Needed to reconcile against the PO and to pay.', severity: 'high', present: (f) => !!f.total },
    ],
  },
  contract: {
    name: 'Commercial contract',
    fields: [
      { key: 'parties', label: 'Parties to the agreement', why: 'A contract must clearly name who is bound by it.', severity: 'high', present: (f) => f.parties.length >= 2 },
      { key: 'effective_date', label: 'Effective date', why: 'Obligations and notice periods are counted from it.', severity: 'high', present: (f) => !!f.effectiveDate },
      { key: 'term', label: 'Term or end date', why: 'Without a term you cannot tell when the contract ends or renews.', severity: 'medium', present: (f) => !!(f.endDate || f.renewalDate) },
      { key: 'payment_terms', label: 'Payment terms', why: 'States how much is payable and when.', severity: 'medium', present: (f) => !!f.paymentTerms },
      { key: 'termination', label: 'Termination clause', why: 'Explains how either party can exit.', severity: 'medium', present: (f) => !!f.termination },
      { key: 'governing_law', label: 'Governing law / jurisdiction', why: 'Decides which courts handle a dispute.', severity: 'low', present: (f) => !!f.governingLaw },
      { key: 'signature', label: 'Signature block', why: 'An unsigned contract is hard to enforce.', severity: 'medium', present: (f) => !!f.signature },
    ],
  },
  purchase_order: {
    name: 'Purchase order',
    fields: [
      { key: 'po_number', label: 'PO number', why: 'Invoices and deliveries are matched against it.', severity: 'high', present: (f) => !!f.poNumber },
      { key: 'po_date', label: 'PO date', why: 'Starts the delivery and payment clock.', severity: 'high', present: (f) => !!f.poDate },
      { key: 'vendor', label: 'Vendor', why: 'Identifies who must deliver.', severity: 'high', present: (f) => !!f.supplier },
      { key: 'delivery_date', label: 'Delivery date', why: 'Without it, late delivery cannot be enforced.', severity: 'medium', present: (f) => !!f.deliveryDate },
      { key: 'delivery_address', label: 'Delivery address', why: 'Tells the vendor where to ship.', severity: 'low', present: (f) => !!f.deliveryAddress },
      { key: 'line_items', label: 'Line items with rates', why: 'Rates are what the invoice is checked against.', severity: 'high', present: (f) => f.items.length > 0 },
      { key: 'payment_terms', label: 'Payment terms', why: 'Without agreed payment terms the vendor can demand payment on delivery.', severity: 'medium', present: (f) => !!f.paymentTerms },
      { key: 'hsn', label: 'HSN / SAC codes', why: 'Lets the vendor’s invoice carry the right tax classification.', severity: 'low', present: (f) => !!f.hsn },
      { key: 'signature', label: 'Authorised signature', why: 'Shows the order was approved.', severity: 'medium', present: (f) => !!f.signature },
    ],
  },
  delivery_note: {
    name: 'Delivery note',
    fields: [
      { key: 'dn_number', label: 'Delivery note number', why: 'Used to match the delivery to the invoice.', severity: 'high', present: (f) => !!f.dnNumber },
      { key: 'dn_date', label: 'Delivery date', why: 'Proves when goods arrived.', severity: 'high', present: (f) => !!(f.dnDate || f.deliveryDate) },
      { key: 'po_reference', label: 'PO reference', why: 'Links the delivery to what was ordered.', severity: 'medium', present: (f) => !!f.poReference },
      { key: 'line_items', label: 'Quantities delivered', why: 'Needed for the three-way match.', severity: 'high', present: (f) => f.items.length > 0 },
      { key: 'received_by', label: 'Received-by signature', why: 'Proof that someone accepted the goods.', severity: 'medium', present: (f) => !!f.receivedBy || !!f.signature },
    ],
  },
};

export interface ChecklistItem {
  key: string;
  label: string;
  why: string;
  severity: Severity;
  present: boolean;
}

export function checkMissing(f: Facts): { schema: string | null; checklist: ChecklistItem[]; completeness: number | null } {
  const schema = SCHEMAS[f.docType];
  if (!schema) return { schema: null, checklist: [], completeness: null };
  const checklist = schema.fields.map((r) => ({ key: r.key, label: r.label, why: r.why, severity: r.severity, present: r.present(f) }));
  const total = checklist.reduce((s, c) => s + W[c.severity], 0);
  const got = checklist.filter((c) => c.present).reduce((s, c) => s + W[c.severity], 0);
  return { schema: schema.name, checklist, completeness: Math.round((got / total) * 100) };
}
