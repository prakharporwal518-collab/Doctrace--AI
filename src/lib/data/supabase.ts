// SupabaseRepo: Postgres + Storage. Row Level Security (see
// supabase/migrations) guarantees a user can only ever read or write their own
// rows, so these queries do not need to filter by user_id for safety; they do
// it anyway for clarity and index use.

import type { SupabaseClient } from '@supabase/supabase-js';
import { STORAGE_BUCKET } from '../config';
import { nowISO, uuid } from '../id';
import type { Anomaly, AuditLog, ChatMessage, Correction, DocumentBundle, DocumentRow, Extraction, MatchGroup, MissingField, Obligation, Profile, Vendor } from '../types';
import { RepoError, type DocumentSummary, type ProcessedRows, type Repo } from './repo';

const DOC_SUMMARY_COLUMNS =
  'id,user_id,file_name,file_url,mime_type,file_size,doc_type,sha256_hash,page_count,status,trust_score,completeness,fields_extracted,fields_discarded,engine,vendor_id,tamper_warning,error_message,uploaded_at';

/** Throw a readable error for a failed Supabase call. */
function check<T>(res: { data: T; error: { message: string; code?: string } | null }, what: string): T {
  if (res.error) {
    const hint = res.error.code === '42P01' ? ' (table missing: run the SQL migration in supabase/migrations)' : res.error.code === '42501' ? ' (blocked by Row Level Security)' : '';
    throw new RepoError(`Could not ${what}: ${res.error.message}${hint}`, res.error);
  }
  return res.data;
}

function safeName(name: string): string {
  return name.replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'document';
}

async function insertChunks(client: SupabaseClient, table: string, rows: object[], what: string) {
  for (let i = 0; i < rows.length; i += 500) {
    check(await client.from(table).insert(rows.slice(i, i + 500)), what);
  }
}

export class SupabaseRepo implements Repo {
  readonly mode = 'cloud' as const;
  constructor(private client: SupabaseClient, readonly userId: string) {}

  async getProfile(): Promise<Profile> {
    const res = await this.client.from('profiles').select('*').eq('id', this.userId).maybeSingle();
    const row = check(res, 'load your profile') as Profile | null;
    if (row) return row;
    // The trigger normally creates it; create it here if the trigger was skipped.
    const fresh = { id: this.userId, full_name: null, organisation: null, role: 'uploader', language: 'en', avatar_url: null, privacy_mode: false };
    return check(await this.client.from('profiles').upsert(fresh).select('*').single(), 'create your profile') as Profile;
  }

  async updateProfile(patch: Partial<Profile>): Promise<Profile> {
    const { id: _id, created_at: _c, ...rest } = patch as Profile;
    return check(await this.client.from('profiles').update(rest).eq('id', this.userId).select('*').single(), 'save your profile') as Profile;
  }

  async listDocuments(): Promise<DocumentSummary[]> {
    const res = await this.client.from('documents').select(DOC_SUMMARY_COLUMNS).eq('user_id', this.userId).order('uploaded_at', { ascending: false });
    return check(res, 'load documents') as unknown as DocumentSummary[];
  }

  async getBundle(id: string): Promise<DocumentBundle | null> {
    const doc = check(await this.client.from('documents').select('*').eq('id', id).maybeSingle(), 'load the document') as DocumentRow | null;
    if (!doc) return null;
    const [ex, an, mi, ob, ch] = await Promise.all([
      this.client.from('extractions').select('*').eq('document_id', id).order('page').order('line'),
      this.client.from('anomalies').select('*').eq('document_id', id),
      this.client.from('missing_fields').select('*').eq('document_id', id),
      this.client.from('obligations').select('*').eq('document_id', id),
      this.client.from('chat_messages').select('*').eq('document_id', id).order('created_at'),
    ]);
    return {
      document: doc,
      extractions: check(ex, 'load fields') as Extraction[],
      anomalies: check(an, 'load anomalies') as Anomaly[],
      missing: check(mi, 'load missing fields') as MissingField[],
      obligations: check(ob, 'load obligations') as Obligation[],
      chat: check(ch, 'load chat') as ChatMessage[],
    };
  }

  async findByName(fileName: string): Promise<DocumentSummary[]> {
    const res = await this.client.from('documents').select(DOC_SUMMARY_COLUMNS).eq('user_id', this.userId).ilike('file_name', fileName.replace(/[%_]/g, '\\$&'));
    return check(res, 'check earlier uploads') as unknown as DocumentSummary[];
  }

  async createDocument(doc: DocumentRow, file: Blob): Promise<string> {
    const path = `${this.userId}/${doc.id}/${safeName(doc.file_name)}`;
    const up = await this.client.storage.from(STORAGE_BUCKET).upload(path, file, { contentType: doc.mime_type || 'application/octet-stream', upsert: false });
    if (up.error) throw new RepoError(`Upload failed: ${up.error.message}${/bucket/i.test(up.error.message) ? ' (create the "documents" bucket: see README)' : ''}`, up.error);
    const ins = await this.client.from('documents').insert({ ...doc, user_id: this.userId, file_url: path });
    if (ins.error) {
      await this.client.storage.from(STORAGE_BUCKET).remove([path]);
      check(ins, 'save the document');
    }
    return path;
  }

  async completeDocument(rows: ProcessedRows): Promise<void> {
    const { file_url: _f, user_id: _u, ...docPatch } = rows.document;
    check(await this.client.from('documents').update(docPatch).eq('id', rows.document.id), 'save results');
    try {
      await insertChunks(this.client, 'extractions', rows.extractions, 'save fields');
      await insertChunks(this.client, 'anomalies', rows.anomalies, 'save anomalies');
      await insertChunks(this.client, 'missing_fields', rows.missing, 'save missing fields');
      await insertChunks(this.client, 'obligations', rows.obligations, 'save obligations');
    } catch (err) {
      // Leave no half-written document behind.
      await this.client.from('documents').update({ status: 'failed', error_message: (err as Error).message }).eq('id', rows.document.id);
      for (const t of ['obligations', 'extractions', 'anomalies', 'missing_fields']) await this.client.from(t).delete().eq('document_id', rows.document.id);
      throw err;
    }
  }

  async failDocument(id: string, message: string): Promise<void> {
    check(await this.client.from('documents').update({ status: 'failed', error_message: message.slice(0, 500) }).eq('id', id), 'mark the document as failed');
  }

  async updateDocument(id: string, patch: Partial<DocumentRow>): Promise<void> {
    const { id: _i, user_id: _u, ...rest } = patch as DocumentRow;
    check(await this.client.from('documents').update(rest).eq('id', id), 'update the document');
  }

  async deleteDocument(id: string): Promise<void> {
    const doc = check(await this.client.from('documents').select('file_url').eq('id', id).maybeSingle(), 'find the document') as { file_url: string } | null;
    check(await this.client.from('documents').delete().eq('id', id), 'delete the document'); // children cascade
    if (doc?.file_url) await this.client.storage.from(STORAGE_BUCKET).remove([doc.file_url]);
  }

  async getFile(doc: Pick<DocumentRow, 'file_url'>): Promise<Blob> {
    const res = await this.client.storage.from(STORAGE_BUCKET).download(doc.file_url);
    if (res.error || !res.data) throw new RepoError(`Could not download the file: ${res.error?.message ?? 'not found'}`, res.error);
    return res.data;
  }

  async listExtractions(opts: { category?: Extraction['category']; documentIds?: string[] } = {}): Promise<Extraction[]> {
    let q = this.client.from('extractions').select('*');
    if (opts.category) q = q.eq('category', opts.category);
    if (opts.documentIds) {
      if (!opts.documentIds.length) return [];
      q = q.in('document_id', opts.documentIds);
    }
    return check(await q, 'load fields') as Extraction[];
  }

  async listAnomalies(): Promise<Anomaly[]> {
    return check(await this.client.from('anomalies').select('*'), 'load anomalies') as Anomaly[];
  }

  async listMissing(): Promise<MissingField[]> {
    return check(await this.client.from('missing_fields').select('*'), 'load missing fields') as MissingField[];
  }

  async listObligations(): Promise<Obligation[]> {
    return check(await this.client.from('obligations').select('*'), 'load obligations') as Obligation[];
  }

  async updateExtraction(id: string, patch: Partial<Extraction>): Promise<void> {
    const { id: _i, document_id: _d, ...rest } = patch as Extraction;
    check(await this.client.from('extractions').update(rest).eq('id', id), 'update the field');
  }

  async addCorrection(c: Correction): Promise<void> {
    check(await this.client.from('corrections').insert({ ...c, user_id: this.userId }), 'save the correction');
  }

  async listCorrections(extractionIds: string[]): Promise<Correction[]> {
    if (!extractionIds.length) return [];
    const res = await this.client.from('corrections').select('*').in('extraction_id', extractionIds).order('created_at', { ascending: false });
    return check(res, 'load corrections') as Correction[];
  }

  async updateObligation(id: string, patch: Partial<Obligation>): Promise<void> {
    const { id: _i, document_id: _d, ...rest } = patch as Obligation;
    check(await this.client.from('obligations').update(rest).eq('id', id), 'update the obligation');
  }

  async replaceAnomalies(documentId: string, rows: Anomaly[]): Promise<void> {
    check(await this.client.from('anomalies').delete().eq('document_id', documentId), 'refresh anomalies');
    await insertChunks(this.client, 'anomalies', rows, 'save anomalies');
  }

  async addChatMessages(msgs: ChatMessage[]): Promise<void> {
    await insertChunks(this.client, 'chat_messages', msgs.map((m) => ({ ...m, user_id: this.userId })), 'save the chat');
  }

  async clearChat(documentId: string): Promise<void> {
    check(await this.client.from('chat_messages').delete().eq('document_id', documentId), 'clear the chat');
  }

  async listVendors(): Promise<Vendor[]> {
    return check(await this.client.from('vendors').select('*').eq('user_id', this.userId), 'load vendors') as Vendor[];
  }

  async saveVendors(rows: Vendor[]): Promise<void> {
    const keep = rows.map((r) => r.id);
    if (rows.length) check(await this.client.from('vendors').upsert(rows.map((r) => ({ ...r, user_id: this.userId }))), 'save vendors');
    const all = await this.listVendors();
    const stale = all.filter((v) => !keep.includes(v.id)).map((v) => v.id);
    if (stale.length) {
      check(await this.client.from('documents').update({ vendor_id: null }).in('vendor_id', stale), 'unlink vendors');
      check(await this.client.from('vendors').delete().in('id', stale), 'remove old vendors');
    }
  }

  async listMatchGroups(): Promise<MatchGroup[]> {
    return check(await this.client.from('match_groups').select('*').order('created_at', { ascending: false }), 'load matches') as MatchGroup[];
  }

  async saveMatchGroup(g: MatchGroup): Promise<void> {
    check(await this.client.from('match_groups').upsert({ ...g, user_id: this.userId }), 'save the match');
  }

  async deleteMatchGroup(id: string): Promise<void> {
    check(await this.client.from('match_groups').delete().eq('id', id), 'delete the match');
  }

  async log(action: string, details: Record<string, unknown> = {}, documentId: string | null = null): Promise<void> {
    const row: AuditLog = { id: uuid(), user_id: this.userId, document_id: documentId, action, details, created_at: nowISO() };
    const res = await this.client.from('audit_logs').insert(row);
    // The audit log must never break the action it records.
    if (res.error) console.warn('Audit log write failed:', res.error.message);
  }

  async listAudit(limit = 500): Promise<AuditLog[]> {
    const res = await this.client.from('audit_logs').select('*').eq('user_id', this.userId).order('created_at', { ascending: false }).limit(limit);
    return check(res, 'load the audit log') as AuditLog[];
  }

  async resetAll(): Promise<void> {
    const docs = await this.listDocuments();
    const paths = docs.map((d) => d.file_url).filter(Boolean);
    for (let i = 0; i < paths.length; i += 100) await this.client.storage.from(STORAGE_BUCKET).remove(paths.slice(i, i + 100));
    check(await this.client.from('match_groups').delete().eq('user_id', this.userId), 'clear matches');
    check(await this.client.from('documents').delete().eq('user_id', this.userId), 'clear documents');
    check(await this.client.from('vendors').delete().eq('user_id', this.userId), 'clear vendors');
    check(await this.client.from('audit_logs').delete().eq('user_id', this.userId), 'clear the audit log');
  }
}
