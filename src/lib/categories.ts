// Colours and names for each kind of finding (deadline purple, amount green,
// anomaly red, obligation blue, missing orange).
import type { Category } from './types';

export type Kind = Category | 'anomaly' | 'missing';

export const KIND: Record<Kind, { label: string; color: string }> = {
  deadline: { label: 'Deadline', color: '#8f88ff' },
  date: { label: 'Date', color: '#8f88ff' },
  amount: { label: 'Amount', color: '#3ecf8e' },
  line_item: { label: 'Line item', color: '#3ecf8e' },
  obligation: { label: 'Obligation', color: '#4ea8ff' },
  party: { label: 'Party', color: '#a9b4cc' },
  identifier: { label: 'Identifier', color: '#a9b4cc' },
  anomaly: { label: 'Anomaly', color: '#ff5d6c' },
  missing: { label: 'Missing data', color: '#ff9f43' },
};

export const DOC_TYPE_LABEL: Record<string, string> = {
  invoice: 'Invoice',
  contract: 'Contract',
  purchase_order: 'Purchase order',
  delivery_note: 'Delivery note',
  other: 'Other',
};
