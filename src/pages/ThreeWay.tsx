import { ArrowLeftRight, Link2, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/app/auth';
import { useData } from '@/app/data';
import { t } from '@/app/i18n';
import { useToast } from '@/app/toast';
import { useAsync } from '@/app/useAsync';
import { Button, cx, EmptyState, ErrorState, PageHeader, SkeletonRows } from '@/components/ui';
import { formatINR } from '@/lib/engine/money';
import { itemsFromExtractions, threeWayMatch, type MatchCell } from '@/lib/engine/threeway';
import { nowISO, uuid } from '@/lib/id';
import { DELIVERY_NOTE } from '@/lib/pdfgen/samples';
import { sampleFile } from '@/lib/services/samples';
import { uploadAndProcess } from '@/lib/services/upload';
import type { Citation } from '@/lib/types';

export default function ThreeWay() {
  const { repo, profile } = useSession();
  const { version, bump } = useData();
  const toast = useToast();
  const { data: docsData, error, loading, reload } = useAsync(async () => {
    const [docs, groups, refs] = await Promise.all([repo.listDocuments(), repo.listMatchGroups(), repo.listExtractions({ category: 'identifier' })]);
    return { docs: docs.filter((d) => d.status === 'ready'), groups, refs };
  }, [repo, version]);

  const [poId, setPo] = useState('');
  const [invId, setInv] = useState('');
  const [dnId, setDn] = useState('');
  const [adding, setAdding] = useState(false);

  const pos = docsData?.docs.filter((d) => d.doc_type === 'purchase_order') ?? [];
  const invoices = docsData?.docs.filter((d) => d.doc_type === 'invoice') ?? [];
  const dns = docsData?.docs.filter((d) => d.doc_type === 'delivery_note') ?? [];

  // Start from the saved link, then auto-suggest by PO reference numbers.
  useEffect(() => {
    if (!docsData) return;
    const g = docsData.groups[0];
    const exists = (id: string | null | undefined) => (id && docsData.docs.some((d) => d.id === id) ? id : '');
    let po = exists(g?.po_id) || (pos.length === 1 ? pos[0].id : '');
    let inv = exists(g?.invoice_id);
    let dn = exists(g?.delivery_id);
    const poNumber = docsData.refs.find((r) => r.document_id === po && r.label === 'PO number')?.normalized_value;
    if (poNumber) {
      const refersTo = (type: string) => docsData.refs.find((r) => r.label === 'PO reference' && r.normalized_value === poNumber && docsData.docs.find((d) => d.id === r.document_id)?.doc_type === type)?.document_id ?? '';
      inv ||= refersTo('invoice');
      dn ||= refersTo('delivery_note');
    }
    po ||= '';
    setPo(po);
    setInv(inv);
    setDn(dn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docsData]);

  const { data: match, loading: matching } = useAsync(async () => {
    if (!poId && !invId && !dnId) return null;
    const ids = [poId, invId, dnId].filter(Boolean);
    const ex = await repo.listExtractions({ category: 'line_item', documentIds: ids });
    const name = (id: string) => docsData?.docs.find((d) => d.id === id)?.file_name ?? '';
    const of = (id: string) => (id ? itemsFromExtractions(ex.filter((e) => e.document_id === id), id, name(id)) : []);
    return threeWayMatch(of(poId), of(invId), of(dnId));
  }, [repo, poId, invId, dnId, docsData, version]);

  const save = async () => {
    try {
      const existing = docsData?.groups[0];
      await repo.saveMatchGroup({ id: existing?.id ?? uuid(), user_id: repo.userId, po_id: poId || null, invoice_id: invId || null, delivery_id: dnId || null, created_at: existing?.created_at ?? nowISO() });
      await repo.log('three_way_match', { po_id: poId, invoice_id: invId, delivery_id: dnId, mismatches: match?.summary.mismatches ?? 0 });
      toast.success('Documents linked', 'This three-way match is saved.');
      bump();
    } catch (err) {
      toast.error('Could not save the link', (err as Error).message);
    }
  };

  const addSampleDn = async () => {
    setAdding(true);
    try {
      const r = await uploadAndProcess(await sampleFile(DELIVERY_NOTE), { repo, profile });
      setDn(r.documentId);
      toast.success('Delivery note added', 'DN-5521 was processed and linked below.');
      bump();
    } catch (err) {
      toast.error('Could not add the delivery note', (err as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const select = (label: string, value: string, set: (v: string) => void, list: typeof pos) => (
    <label className="text-sm">
      <span className="label">{label}</span>
      <select className="input mt-1" value={value} onChange={(e) => set(e.target.value)}>
        <option value="">— none —</option>
        {list.map((d) => (
          <option key={d.id} value={d.id}>
            {d.file_name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div>
      <PageHeader title={t('threeWay', profile.language)} subtitle="Purchase order vs invoice vs delivery note, line by line, with a citation for every number." />
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && !docsData ? (
        <SkeletonRows />
      ) : (
        <>
          <div className="card mb-5 grid gap-3 p-4 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
            {select('Purchase order', poId, setPo, pos)}
            {select('Invoice', invId, setInv, invoices)}
            <div>
              {select('Delivery note', dnId, setDn, dns)}
              {!dns.length && (
                <button type="button" onClick={() => void addSampleDn()} disabled={adding} className="mt-1.5 flex items-center gap-1 text-xs text-yellow hover:underline disabled:opacity-50">
                  <Plus className="size-3" /> {adding ? 'Processing DN-5521…' : 'Add the sample delivery note DN-5521'}
                </button>
              )}
            </div>
            <Button onClick={() => void save()} disabled={!poId && !invId && !dnId}>
              <Link2 className="size-4" /> Save link
            </Button>
          </div>

          {!poId && !invId && !dnId ? (
            <EmptyState icon={<ArrowLeftRight className="size-8" />} title="Pick the documents to match" body="Choose a purchase order and an invoice (and optionally a delivery note). Line items are matched by description." />
          ) : matching && !match ? (
            <SkeletonRows rows={3} />
          ) : match && match.rows.length ? (
            <>
              <div className={cx('mb-4 rounded-lg border p-3 text-sm', match.summary.mismatches ? 'border-anomaly/40 bg-anomaly/10' : 'border-amount/40 bg-amount/10')}>
                {match.summary.mismatches ? (
                  <>
                    <b>{match.summary.mismatches}</b> line{match.summary.mismatches === 1 ? '' : 's'} do not match. Money at stake: <b>{formatINR(match.summary.exposure)}</b>.
                  </>
                ) : (
                  'All lines match across the linked documents.'
                )}
              </div>
              <div className="card overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-faint">
                      <th className="px-3 py-2.5 font-medium">Item</th>
                      <th className="px-3 py-2.5 font-medium">Purchase order</th>
                      <th className="px-3 py-2.5 font-medium">Invoice</th>
                      <th className="px-3 py-2.5 font-medium">Delivery note</th>
                      <th className="px-3 py-2.5 font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {match.rows.map((r) => (
                      <tr key={r.key} className={cx('border-b border-line align-top last:border-0', r.issues.length > 0 && 'bg-anomaly/[0.05]')}>
                        <td className="px-3 py-3 font-medium">{r.description}</td>
                        <Cell c={r.po} />
                        <Cell c={r.invoice} highlight={r.issues.some((x) => /Rate|Quantity|Amount/.test(x))} />
                        <Cell c={r.delivery} qtyOnly />
                        <td className="px-3 py-3">
                          {r.issues.length ? (
                            <ul className="space-y-1 text-[#ff8a95]">
                              {r.issues.map((x) => (
                                <li key={x}>{x}</li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-amount">✓ Match</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <EmptyState title="No line items found" body="The selected documents have no line items with quantity, rate and amount." />
          )}
        </>
      )}
    </div>
  );
}

function Cell({ c, highlight, qtyOnly }: { c: MatchCell; highlight?: boolean; qtyOnly?: boolean }) {
  if (c.qty == null) return <td className="px-3 py-3 text-faint">—</td>;
  const cite: Citation = c.citation!;
  return (
    <td className={cx('px-3 py-3', highlight && 'text-[#ffb877]')}>
      <p className="tabular-nums">
        {c.qty} × {formatINR(c.rate)}
      </p>
      {!qtyOnly && <p className="text-xs text-faint tabular-nums">= {formatINR(c.amount)}</p>}
      <Link to={`/documents/${cite.document_id}?line=${cite.page}-${cite.line}`} className="cite mt-1 inline-block text-yellow/90 hover:underline" title={cite.source_text}>
        ↳ p.{cite.page} · L{cite.line}
      </Link>
    </td>
  );
}
