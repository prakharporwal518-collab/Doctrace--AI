// LocalRepo: the full Repo contract on top of IndexedDB. Every query is
// scoped to the signed-in local user, mirroring the Supabase RLS policies.

import { nowISO, uuid } from '../id';
import type { Anomaly, AuditLog, ChatMessage, Correction, DocumentBundle, DocumentRow, Extraction, MatchGroup, MissingField, Obligation, Profile, Vendor } from '../types';
import { CHILD_STORES, db } from './localdb';
import { RepoError, type DocumentSummary, type ProcessedRows, type Repo } from './repo';

const strip = (d: DocumentRow): DocumentSummary => {
  const { pages: _pages, ...rest } = d;
  return rest;
};

export class LocalRepo implements Repo {
  readonly mode = 'local' as const;
  constructor(readonly userId: string) {}

  private async myDocIds(): Promise<Set<string>> {
    const d = await db();
    return new Set((await d.getAllFromIndex('documents', 'user_id', this.userId)).map((x) => x.id));
  }

  private async ownDoc(id: string): Promise<DocumentRow> {
    const doc = await (await db()).get('documents', id);
    if (!doc || doc.user_id !== this.userId) throw new RepoError('Document not found.');
    return doc;
  }

  async getProfile(): Promise<Profile> {
    const d = await db();
    const p = await d.get('profiles', this.userId);
    if (p) return p;
    const fresh: Profile = { id: this.userId, full_name: null, organisation: null, role: 'uploader', language: 'en', avatar_url: null, privacy_mode: false, created_at: nowISO() };
    await d.put('profiles', fresh);
    return fresh;
  }

  async updateProfile(patch: Partial<Profile>): Promise<Profile> {
    const p = { ...(await this.getProfile()), ...patch, id: this.userId };
    await (await db()).put('profiles', p);
    return p;
  }

  async listDocuments(): Promise<DocumentSummary[]> {
    const rows = await (await db()).getAllFromIndex('documents', 'user_id', this.userId);
    return rows.map(strip).sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
  }

  async getBundle(id: string): Promise<DocumentBundle | null> {
    const d = await db();
    const document = await d.get('documents', id);
    if (!document || document.user_id !== this.userId) return null;
    const [extractions, anomalies, missing, obligations, chat] = await Promise.all([
      d.getAllFromIndex('extractions', 'document_id', id),
      d.getAllFromIndex('anomalies', 'document_id', id),
      d.getAllFromIndex('missing_fields', 'document_id', id),
      d.getAllFromIndex('obligations', 'document_id', id),
      d.getAllFromIndex('chat_messages', 'document_id', id),
    ]);
    chat.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return { document, extractions, anomalies, missing, obligations, chat };
  }

  async findByName(fileName: string): Promise<DocumentSummary[]> {
    return (await this.listDocuments()).filter((x) => x.file_name.toLowerCase() === fileName.toLowerCase());
  }

  async createDocument(doc: DocumentRow, file: Blob): Promise<string> {
    const d = await db();
    const path = `${this.userId}/${doc.id}/${doc.file_name}`;
    const tx = d.transaction(['documents', 'files'], 'readwrite');
    await Promise.all([tx.objectStore('documents').put({ ...doc, user_id: this.userId, file_url: path }), tx.objectStore('files').put({ id: doc.id, blob: file }), tx.done]);
    return path;
  }

  async completeDocument(rows: ProcessedRows): Promise<void> {
    const existing = await this.ownDoc(rows.document.id);
    const d = await db();
    const tx = d.transaction(['documents', 'extractions', 'anomalies', 'missing_fields', 'obligations'], 'readwrite');
    const ops: Promise<unknown>[] = [tx.objectStore('documents').put({ ...rows.document, user_id: this.userId, file_url: existing.file_url })];
    for (const r of rows.extractions) ops.push(tx.objectStore('extractions').put(r));
    for (const r of rows.anomalies) ops.push(tx.objectStore('anomalies').put(r));
    for (const r of rows.missing) ops.push(tx.objectStore('missing_fields').put(r));
    for (const r of rows.obligations) ops.push(tx.objectStore('obligations').put(r));
    await Promise.all([...ops, tx.done]);
  }

  async failDocument(id: string, message: string): Promise<void> {
    await this.updateDocument(id, { status: 'failed', error_message: message });
  }

  async updateDocument(id: string, patch: Partial<DocumentRow>): Promise<void> {
    const doc = await this.ownDoc(id);
    await (await db()).put('documents', { ...doc, ...patch, id, user_id: this.userId });
  }

  async deleteDocument(id: string): Promise<void> {
    await this.ownDoc(id);
    const d = await db();
    const extractionIds = (await d.getAllFromIndex('extractions', 'document_id', id)).map((e) => e.id);
    const tx = d.transaction(['documents', 'files', ...CHILD_STORES, 'corrections', 'match_groups'] as const, 'readwrite');
    const ops: Promise<unknown>[] = [tx.objectStore('documents').delete(id), tx.objectStore('files').delete(id)];
    for (const store of CHILD_STORES) {
      const keys = await tx.objectStore(store).index('document_id').getAllKeys(id);
      for (const k of keys) ops.push(tx.objectStore(store).delete(k));
    }
    for (const eid of extractionIds) {
      const keys = await tx.objectStore('corrections').index('extraction_id').getAllKeys(eid);
      for (const k of keys) ops.push(tx.objectStore('corrections').delete(k));
    }
    // Unlink the document from three-way matches (like ON DELETE SET NULL).
    for (const g of await tx.objectStore('match_groups').getAll()) {
      if (g.user_id !== this.userId) continue;
      if ([g.po_id, g.invoice_id, g.delivery_id].includes(id)) {
        ops.push(tx.objectStore('match_groups').put({ ...g, po_id: g.po_id === id ? null : g.po_id, invoice_id: g.invoice_id === id ? null : g.invoice_id, delivery_id: g.delivery_id === id ? null : g.delivery_id }));
      }
    }
    await Promise.all([...ops, tx.done]);
  }

  async getFile(doc: Pick<DocumentRow, 'id'>): Promise<Blob> {
    await this.ownDoc(doc.id);
    const f = await (await db()).get('files', doc.id);
    if (!f) throw new RepoError('The original file is missing from this browser.');
    return f.blob;
  }

  private async children<T extends { document_id: string }>(store: (typeof CHILD_STORES)[number], ids?: Set<string>): Promise<T[]> {
    const d = await db();
    const mine = ids ?? (await this.myDocIds());
    const out: T[] = [];
    for (const id of mine) out.push(...((await d.getAllFromIndex(store, 'document_id', id)) as unknown as T[]));
    return out;
  }

  async listExtractions(opts: { category?: Extraction['category']; documentIds?: string[] } = {}): Promise<Extraction[]> {
    const mine = await this.myDocIds();
    const ids = opts.documentIds ? new Set(opts.documentIds.filter((x) => mine.has(x))) : mine;
    const rows = await this.children<Extraction>('extractions', ids);
    return opts.category ? rows.filter((r) => r.category === opts.category) : rows;
  }
  listAnomalies = () => this.children<Anomaly>('anomalies');
  listMissing = () => this.children<MissingField>('missing_fields');
  listObligations = () => this.children<Obligation>('obligations');

  async updateExtraction(id: string, patch: Partial<Extraction>): Promise<void> {
    const d = await db();
    const row = await d.get('extractions', id);
    if (!row) throw new RepoError('Field not found.');
    await this.ownDoc(row.document_id);
    await d.put('extractions', { ...row, ...patch, id });
  }

  async addCorrection(c: Correction): Promise<void> {
    await (await db()).put('corrections', { ...c, user_id: this.userId });
  }

  async listCorrections(extractionIds: string[]): Promise<Correction[]> {
    const d = await db();
    const out: Correction[] = [];
    for (const id of extractionIds) out.push(...(await d.getAllFromIndex('corrections', 'extraction_id', id)));
    return out.filter((c) => c.user_id === this.userId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async updateObligation(id: string, patch: Partial<Obligation>): Promise<void> {
    const d = await db();
    const row = await d.get('obligations', id);
    if (!row) throw new RepoError('Obligation not found.');
    await this.ownDoc(row.document_id);
    await d.put('obligations', { ...row, ...patch, id });
  }

  async replaceAnomalies(documentId: string, rows: Anomaly[]): Promise<void> {
    await this.ownDoc(documentId);
    const d = await db();
    const tx = d.transaction('anomalies', 'readwrite');
    const keys = await tx.store.index('document_id').getAllKeys(documentId);
    await Promise.all([...keys.map((k) => tx.store.delete(k)), ...rows.map((r) => tx.store.put(r)), tx.done]);
  }

  async addChatMessages(msgs: ChatMessage[]): Promise<void> {
    const d = await db();
    for (const m of msgs) await this.ownDoc(m.document_id);
    const tx = d.transaction('chat_messages', 'readwrite');
    await Promise.all([...msgs.map((m) => tx.store.put({ ...m, user_id: this.userId })), tx.done]);
  }

  async clearChat(documentId: string): Promise<void> {
    await this.ownDoc(documentId);
    const d = await db();
    const tx = d.transaction('chat_messages', 'readwrite');
    const keys = await tx.store.index('document_id').getAllKeys(documentId);
    await Promise.all([...keys.map((k) => tx.store.delete(k)), tx.done]);
  }

  async listVendors(): Promise<Vendor[]> {
    return (await db()).getAllFromIndex('vendors', 'user_id', this.userId);
  }

  async saveVendors(rows: Vendor[]): Promise<void> {
    const d = await db();
    const tx = d.transaction('vendors', 'readwrite');
    const old = await tx.store.index('user_id').getAllKeys(this.userId);
    await Promise.all([...old.map((k) => tx.store.delete(k)), ...rows.map((r) => tx.store.put({ ...r, user_id: this.userId })), tx.done]);
  }

  async listMatchGroups(): Promise<MatchGroup[]> {
    return (await (await db()).getAllFromIndex('match_groups', 'user_id', this.userId)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async saveMatchGroup(g: MatchGroup): Promise<void> {
    await (await db()).put('match_groups', { ...g, user_id: this.userId });
  }

  async deleteMatchGroup(id: string): Promise<void> {
    const d = await db();
    const g = await d.get('match_groups', id);
    if (g?.user_id === this.userId) await d.delete('match_groups', id);
  }

  async log(action: string, details: Record<string, unknown> = {}, documentId: string | null = null): Promise<void> {
    const row: AuditLog = { id: uuid(), user_id: this.userId, document_id: documentId, action, details, created_at: nowISO() };
    await (await db()).put('audit_logs', row);
  }

  async listAudit(limit = 500): Promise<AuditLog[]> {
    const rows = await (await db()).getAllFromIndex('audit_logs', 'user_id', this.userId);
    return rows.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
  }

  async resetAll(): Promise<void> {
    for (const doc of await this.listDocuments()) await this.deleteDocument(doc.id);
    const d = await db();
    for (const store of ['audit_logs', 'vendors', 'match_groups'] as const) {
      const tx = d.transaction(store, 'readwrite');
      const keys = await tx.store.index('user_id').getAllKeys(this.userId);
      await Promise.all([...keys.map((k) => tx.store.delete(k)), tx.done]);
    }
  }
}
