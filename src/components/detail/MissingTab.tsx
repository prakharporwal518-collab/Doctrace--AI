import { CheckCircle2, CircleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { extractFacts } from '@/lib/engine/facts';
import { checkMissing } from '@/lib/engine/missing';
import type { Extraction, ParsedPage } from '@/lib/types';
import { Cite, cx, EmptyState, SeverityBadge } from '../ui';

// Which extracted label proves a checklist item is present (for its citation).
const PROOF: Record<string, string[]> = {
  invoice_number: ['Invoice number'],
  invoice_date: ['Invoice date'],
  supplier_gstin: ['Supplier GSTIN', 'Vendor GSTIN'],
  buyer_gstin: ['Buyer GSTIN'],
  total: ['Total', 'Order total'],
  po_number: ['PO number'],
  po_date: ['PO date'],
  vendor: ['Vendor', 'Supplier'],
  delivery_date: ['Deliver by', 'Delivery date'],
  dn_number: ['Delivery note number'],
  po_reference: ['PO reference'],
  effective_date: ['Effective date'],
  term: ['Term ends', 'Renewal date'],
  parties: ['Party 1'],
};

export function MissingTab({ pages, extractions, onLocate }: { pages: ParsedPage[] | null; extractions: Extraction[]; onLocate: (id: string) => void }) {
  const result = useMemo(() => (pages ? checkMissing(extractFacts({ pages, source: 'pdf-text' })) : null), [pages]);
  if (!result?.schema) return <EmptyState title="No checklist for this document type" body="Missing-data checks run for invoices, contracts, purchase orders and delivery notes." />;
  const done = result.checklist.filter((c) => c.present).length;
  return (
    <div>
      <div className="card mb-4 p-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="label">Completeness · {result.schema}</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">
              {result.completeness}
              <span className="text-base text-faint">/100</span>
            </p>
          </div>
          <p className="text-sm text-muted">
            {done} of {result.checklist.length} required fields present
          </p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-line">
          <div className={cx('h-full rounded-full', (result.completeness ?? 0) >= 90 ? 'bg-amount' : (result.completeness ?? 0) >= 70 ? 'bg-yellow' : 'bg-missing')} style={{ width: `${result.completeness}%` }} />
        </div>
        <p className="mt-2 text-xs text-faint">Weighted by importance: high-priority fields count 3, medium 2, low 1.</p>
      </div>
      <ul className="space-y-2">
        {result.checklist.map((c) => {
          const proof = c.present ? extractions.find((e) => PROOF[c.key]?.includes(e.label)) : undefined;
          return (
            <li key={c.key} className={cx('card flex items-start gap-3 p-3', !c.present && 'border-missing/40 bg-missing/[0.04]')}>
              {c.present ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-amount" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-missing" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{c.label}</p>
                  {c.present ? proof ? <Cite page={proof.page} line={proof.line} onClick={() => onLocate(`ex:${proof.id}`)} /> : <span className="cite text-amount">found</span> : <SeverityBadge severity={c.severity} />}
                </div>
                {!c.present && <p className="mt-1 text-sm text-muted">{c.why}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
