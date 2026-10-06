// Vendor Risk Profile: group documents by vendor and score the risk.

import type { Repo } from '../data/repo';
import { normalizeName } from '../engine/facts';
import { uuid } from '../id';
import type { Anomaly, DocumentRow, Vendor } from '../types';

/** Explainable risk score: low trust and high-severity anomalies raise it. */
export function vendorRisk(docs: Array<Pick<DocumentRow, 'trust_score'>>, anomalies: Array<Pick<Anomaly, 'severity'>>): number {
  if (!docs.length) return 0;
  const trusts = docs.map((d) => d.trust_score ?? 70);
  const avgTrust = trusts.reduce((s, t) => s + t, 0) / trusts.length;
  const high = anomalies.filter((a) => a.severity === 'high').length;
  const medium = anomalies.filter((a) => a.severity === 'medium').length;
  return Math.max(0, Math.min(100, Math.round((100 - avgTrust) * 0.8 + high * 8 + medium * 3)));
}

/** Find (or create) the vendor for a document and link it. */
export async function assignVendor(repo: Repo, documentId: string, info: { name: string; gstin: string | null } | null): Promise<void> {
  if (!info) return;
  const vendors = await repo.listVendors();
  const key = normalizeName(info.name);
  let v = vendors.find((x) => (info.gstin && x.gstin === info.gstin) || normalizeName(x.name) === key);
  if (!v) {
    v = { id: uuid(), user_id: repo.userId, name: info.name, gstin: info.gstin, total_documents: 0, total_anomalies: 0, risk_score: 0 };
    vendors.push(v);
  } else if (!v.gstin && info.gstin) v.gstin = info.gstin;
  await repo.saveVendors(vendors);
  await repo.updateDocument(documentId, { vendor_id: v.id });
}

/** Recompute document counts, anomaly counts and risk scores for every vendor. */
export async function recomputeVendors(repo: Repo): Promise<Vendor[]> {
  const [vendors, docs, anomalies] = await Promise.all([repo.listVendors(), repo.listDocuments(), repo.listAnomalies()]);
  const next = vendors
    .map((v) => {
      const mine = docs.filter((d) => d.vendor_id === v.id && d.status === 'ready');
      const ids = new Set(mine.map((d) => d.id));
      const an = anomalies.filter((a) => ids.has(a.document_id));
      return { ...v, total_documents: mine.length, total_anomalies: an.length, risk_score: vendorRisk(mine, an) };
    })
    .filter((v) => v.total_documents > 0);
  await repo.saveVendors(next);
  return next;
}
