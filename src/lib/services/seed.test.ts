import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { LocalRepo } from '../data/local';
import { seedDemoData } from './seed';
import type { DocumentBundle } from '../types';

const repo = new LocalRepo('demo-user');
let bundles: Record<string, DocumentBundle>;

beforeAll(async () => {
  await seedDemoData(repo);
  const docs = await repo.listDocuments();
  bundles = Object.fromEntries(await Promise.all(docs.map(async (d) => [d.file_name, (await repo.getBundle(d.id))!])));
}, 60000);

describe('demo seed', () => {
  it('creates the three sample documents with the expected trust scores', async () => {
    expect(Object.keys(bundles).sort()).toEqual(['invoice_0423.pdf', 'purchase_order_PO-7781.pdf', 'service_agreement_nexa.pdf']);
    expect(bundles['invoice_0423.pdf'].document.trust_score).toBe(58);
    expect(bundles['service_agreement_nexa.pdf'].document.trust_score).toBe(86);
    expect(bundles['purchase_order_PO-7781.pdf'].document.trust_score).toBe(92);
    expect(bundles['service_agreement_nexa.pdf'].document.page_count).toBe(4);
    expect(bundles['invoice_0423.pdf'].document.page_count).toBe(2);
  });

  it('cites the invoice exactly as specified', () => {
    const inv = bundles['invoice_0423.pdf'];
    const due = inv.extractions.find((e) => e.label === 'Payment due')!;
    expect(due).toMatchObject({ page: 1, line: 3, normalized_value: '2026-10-15', raw_text: 'Pay by 15 Oct 2026' });
    const total = inv.anomalies.find((a) => a.rule_code === 'ARITH_TOTAL')!;
    expect(total).toMatchObject({ page: 2, line: 18, severity: 'high', expected_value: '₹4,72,000.00', found_value: '₹4,82,500.00' });
    expect(total.title).toContain('₹10,500.00');
    expect(inv.missing.map((m) => m.field_name).sort()).toEqual(['Authorised signature', 'HSN / SAC codes']);
  });

  it('extracts the contract obligations and the auto-renewal notice deadline', () => {
    const msa = bundles['service_agreement_nexa.pdf'];
    const report = msa.obligations.find((o) => /uptime report/i.test(o.action))!;
    expect(report).toMatchObject({ party: 'CloudServe Solutions', recurrence: 'monthly' });
    const pay = msa.obligations.find((o) => /₹1,50,000/.test(o.action))!;
    expect(pay).toMatchObject({ party: 'Nexa Technologies', recurrence: 'quarterly', penalty_amount: 3000 });
    expect(pay.penalty_text).toMatch(/2% per month/);
    const notice = msa.obligations.find((o) => /notice/i.test(o.action))!;
    expect(notice.due_date).toBe('2026-12-01');
  });

  it('creates two vendors, a three-way match link, chat history and 8 audit entries', async () => {
    const vendors = await repo.listVendors();
    expect(vendors.map((v) => v.name).sort()).toEqual(['CloudServe Solutions', 'Sharma Office Supplies Pvt Ltd']);
    const sharma = vendors.find((v) => v.name.startsWith('Sharma'))!;
    expect(sharma.total_documents).toBe(2);
    expect((await repo.listMatchGroups())).toHaveLength(1);
    const chats = Object.values(bundles).flatMap((b) => b.chat);
    expect(chats.filter((c) => c.role === 'user')).toHaveLength(3);
    expect(chats.filter((c) => c.role === 'assistant').every((c) => c.citations.length > 0)).toBe(true);
    expect(await repo.listAudit()).toHaveLength(8);
  });

  it('records the reviewer correction', async () => {
    const inv = bundles['invoice_0423.pdf'];
    const buyer = inv.extractions.find((e) => e.label === 'Buyer')!;
    expect(buyer.reviewer_status).toBe('corrected');
    const corr = await repo.listCorrections([buyer.id]);
    expect(corr[0]).toMatchObject({ old_value: 'Nexa Technologies', new_value: 'Nexa Technologies Pvt Ltd' });
  });

  it('is idempotent: seeding again replaces, never duplicates', async () => {
    await seedDemoData(repo);
    expect(await repo.listDocuments()).toHaveLength(3);
    expect(await repo.listVendors()).toHaveLength(2);
    expect(await repo.listAudit()).toHaveLength(8);
  }, 60000);

  it('keeps users apart', async () => {
    const other = new LocalRepo('someone-else');
    expect(await other.listDocuments()).toHaveLength(0);
    const any = (await repo.listDocuments())[0];
    expect(await other.getBundle(any.id)).toBeNull();
    await expect(other.deleteDocument(any.id)).rejects.toThrow();
  });
});
