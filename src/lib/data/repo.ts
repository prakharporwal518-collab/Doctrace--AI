// The one interface every page talks to. Two implementations:
//   SupabaseRepo (cloud, RLS-protected) and LocalRepo (IndexedDB, offline demo).

import type {
  Anomaly,
  AuditLog,
  ChatMessage,
  Correction,
  DocumentBundle,
  DocumentRow,
  Extraction,
  MatchGroup,
  MissingField,
  Obligation,
  Profile,
  Vendor,
} from '../types';

export interface ProcessedRows {
  document: DocumentRow;
  extractions: Extraction[];
  anomalies: Anomaly[];
  missing: MissingField[];
  obligations: Obligation[];
}

export type DocumentSummary = Omit<DocumentRow, 'pages'>;

export interface Repo {
  readonly mode: 'local' | 'cloud';
  readonly userId: string;

  getProfile(): Promise<Profile>;
  updateProfile(patch: Partial<Omit<Profile, 'id' | 'created_at'>>): Promise<Profile>;

  listDocuments(): Promise<DocumentSummary[]>;
  getBundle(id: string): Promise<DocumentBundle | null>;
  findByName(fileName: string): Promise<DocumentSummary[]>;
  /** Store the file and a `processing` row. Returns the storage path. */
  createDocument(doc: DocumentRow, file: Blob): Promise<string>;
  /** Replace the row and insert all child rows once processing succeeded. */
  completeDocument(rows: ProcessedRows): Promise<void>;
  failDocument(id: string, message: string): Promise<void>;
  updateDocument(id: string, patch: Partial<DocumentRow>): Promise<void>;
  deleteDocument(id: string): Promise<void>;
  getFile(doc: Pick<DocumentRow, 'id' | 'file_url' | 'mime_type'>): Promise<Blob>;

  listExtractions(opts?: { category?: Extraction['category']; documentIds?: string[] }): Promise<Extraction[]>;
  listAnomalies(): Promise<Anomaly[]>;
  listMissing(): Promise<MissingField[]>;
  listObligations(): Promise<Obligation[]>;

  updateExtraction(id: string, patch: Partial<Extraction>): Promise<void>;
  addCorrection(c: Correction): Promise<void>;
  listCorrections(extractionIds: string[]): Promise<Correction[]>;
  updateObligation(id: string, patch: Partial<Obligation>): Promise<void>;
  replaceAnomalies(documentId: string, rows: Anomaly[]): Promise<void>;

  addChatMessages(msgs: ChatMessage[]): Promise<void>;
  clearChat(documentId: string): Promise<void>;

  listVendors(): Promise<Vendor[]>;
  saveVendors(rows: Vendor[]): Promise<void>;

  listMatchGroups(): Promise<MatchGroup[]>;
  saveMatchGroup(g: MatchGroup): Promise<void>;
  deleteMatchGroup(id: string): Promise<void>;

  log(action: string, details?: Record<string, unknown>, documentId?: string | null): Promise<void>;
  listAudit(limit?: number): Promise<AuditLog[]>;

  /** Delete everything this user owns (used by "Reset demo data"). */
  resetAll(): Promise<void>;
}

export class RepoError extends Error {
  constructor(message: string, readonly original?: unknown) {
    super(message);
    this.name = 'RepoError';
  }
}
