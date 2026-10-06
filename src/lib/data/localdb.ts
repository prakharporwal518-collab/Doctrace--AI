// IndexedDB schema for offline demo mode. One object store per table.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Anomaly, AuditLog, ChatMessage, Correction, DocumentRow, Extraction, MatchGroup, MissingField, Obligation, Profile, Vendor } from '../types';

export interface LocalUser {
  id: string;
  email: string;
  salt: string;
  hash: string;
  created_at: string;
}

export interface DocTraceDB extends DBSchema {
  users: { key: string; value: LocalUser; indexes: { email: string } };
  profiles: { key: string; value: Profile };
  documents: { key: string; value: DocumentRow; indexes: { user_id: string } };
  files: { key: string; value: { id: string; blob: Blob } };
  extractions: { key: string; value: Extraction; indexes: { document_id: string } };
  anomalies: { key: string; value: Anomaly; indexes: { document_id: string } };
  missing_fields: { key: string; value: MissingField; indexes: { document_id: string } };
  obligations: { key: string; value: Obligation; indexes: { document_id: string } };
  chat_messages: { key: string; value: ChatMessage; indexes: { document_id: string } };
  corrections: { key: string; value: Correction; indexes: { extraction_id: string } };
  audit_logs: { key: string; value: AuditLog; indexes: { user_id: string } };
  vendors: { key: string; value: Vendor; indexes: { user_id: string } };
  match_groups: { key: string; value: MatchGroup; indexes: { user_id: string } };
}

export const CHILD_STORES = ['extractions', 'anomalies', 'missing_fields', 'obligations', 'chat_messages'] as const;

let dbPromise: Promise<IDBPDatabase<DocTraceDB>> | null = null;

export function db(): Promise<IDBPDatabase<DocTraceDB>> {
  if (!dbPromise) {
    if (typeof indexedDB === 'undefined') throw new Error('This browser has no IndexedDB (private mode?). Offline demo mode needs it.');
    dbPromise = openDB<DocTraceDB>('doctrace', 1, {
      upgrade(d) {
        d.createObjectStore('users', { keyPath: 'id' }).createIndex('email', 'email', { unique: true });
        d.createObjectStore('profiles', { keyPath: 'id' });
        d.createObjectStore('documents', { keyPath: 'id' }).createIndex('user_id', 'user_id');
        d.createObjectStore('files', { keyPath: 'id' });
        for (const name of CHILD_STORES) d.createObjectStore(name, { keyPath: 'id' }).createIndex('document_id', 'document_id');
        d.createObjectStore('corrections', { keyPath: 'id' }).createIndex('extraction_id', 'extraction_id');
        d.createObjectStore('audit_logs', { keyPath: 'id' }).createIndex('user_id', 'user_id');
        d.createObjectStore('vendors', { keyPath: 'id' }).createIndex('user_id', 'user_id');
        d.createObjectStore('match_groups', { keyPath: 'id' }).createIndex('user_id', 'user_id');
      },
      blocked() {
        console.warn('DocTrace: close other tabs to finish upgrading the local database.');
      },
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

/** Test helper: forget the cached connection (used with fake-indexeddb). */
export function resetDbCache() {
  dbPromise = null;
}
