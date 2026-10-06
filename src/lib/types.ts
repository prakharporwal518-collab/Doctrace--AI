// Shared types. Table types mirror supabase/migrations/*_init.sql column for column.

export type DocType = 'invoice' | 'contract' | 'purchase_order' | 'delivery_note' | 'other';
export type DocStatus = 'processing' | 'ready' | 'failed';
export type Category = 'deadline' | 'amount' | 'obligation' | 'party' | 'date' | 'identifier' | 'line_item';
export type ReviewerStatus = 'pending' | 'approved' | 'rejected' | 'corrected';
export type Severity = 'low' | 'medium' | 'high';
export type Role = 'uploader' | 'reviewer';
export type Lang = 'en' | 'hi';
export type ObligationStatus = 'upcoming' | 'done' | 'overdue';
export type Engine = 'rules' | 'gemini' | 'openai';

/** A rectangle on a page, in fractions of the page size (0..1), origin top-left. */
export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a value came from. Every output in the app carries one of these. */
export interface Citation {
  page: number;
  line: number;
  bbox: BBox | null;
  source_text: string;
  document_id?: string;
  file_name?: string;
}

/* ------------------------------------------------------------------ */
/* Parsed document (output of ingest: PDF text layer, OCR or DOCX)     */
/* ------------------------------------------------------------------ */

/** Character range -> horizontal position, so a quote inside a line can be boxed precisely. */
export interface Span {
  start: number;
  end: number;
  x: number;
  w: number;
}

export interface ParsedLine {
  id: string; // "p2-L18"
  page: number;
  line: number;
  text: string;
  bbox: BBox | null;
  spans?: Span[];
}

export interface ParsedPage {
  number: number;
  width: number; // PDF points (or pixels for images)
  height: number;
  lines: ParsedLine[];
}

export interface ParsedDocument {
  pages: ParsedPage[];
  source: 'pdf-text' | 'ocr' | 'docx' | 'text';
  ocrConfidence?: number;
}

/* ------------------------------------------------------------------ */
/* Database rows                                                      */
/* ------------------------------------------------------------------ */

export interface Profile {
  id: string;
  full_name: string | null;
  organisation: string | null;
  role: Role;
  language: Lang;
  avatar_url: string | null;
  privacy_mode: boolean;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  user_id: string;
  file_name: string;
  file_url: string; // storage path
  mime_type: string;
  file_size: number;
  doc_type: DocType;
  sha256_hash: string;
  page_count: number;
  status: DocStatus;
  trust_score: number | null;
  completeness: number | null;
  fields_extracted: number;
  fields_discarded: number;
  engine: Engine;
  vendor_id: string | null;
  tamper_warning: string | null;
  error_message: string | null;
  pages: ParsedPage[] | null;
  uploaded_at: string;
}

export interface Extraction {
  id: string;
  document_id: string;
  category: Category;
  label: string;
  value: string;
  raw_text: string; // the exact source sentence
  normalized_value: string | null;
  page: number;
  line: number;
  bbox: BBox | null;
  confidence: number;
  verified: boolean;
  reviewer_status: ReviewerStatus;
  source: Engine;
  created_at: string;
}

export interface Anomaly {
  id: string;
  document_id: string;
  rule_code: string;
  severity: Severity;
  title: string;
  explanation: string;
  expected_value: string | null;
  found_value: string | null;
  page: number | null;
  line: number | null;
  bbox: BBox | null;
  source_text: string | null;
  related: Citation[];
  created_at: string;
}

export interface MissingField {
  id: string;
  document_id: string;
  field_name: string;
  why_required: string;
  severity: Severity;
}

export interface Obligation {
  id: string;
  document_id: string;
  party: string;
  action: string;
  due_date: string | null; // YYYY-MM-DD
  recurrence: 'monthly' | 'quarterly' | 'yearly' | null;
  penalty_text: string | null;
  penalty_amount: number | null;
  amount: number | null;
  status: ObligationStatus;
  extraction_id: string | null;
  page: number | null;
  line: number | null;
  bbox: BBox | null;
  source_text: string | null;
}

export interface ChatMessage {
  id: string;
  document_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  created_at: string;
}

export interface Correction {
  id: string;
  extraction_id: string;
  user_id: string;
  old_value: string;
  new_value: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  document_id: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface Vendor {
  id: string;
  user_id: string;
  name: string;
  gstin: string | null;
  total_documents: number;
  total_anomalies: number;
  risk_score: number;
}

export interface MatchGroup {
  id: string;
  user_id: string;
  po_id: string | null;
  invoice_id: string | null;
  delivery_id: string | null;
  created_at: string;
}

/** Everything the document detail page needs, in one object. */
export interface DocumentBundle {
  document: DocumentRow;
  extractions: Extraction[];
  anomalies: Anomaly[];
  missing: MissingField[];
  obligations: Obligation[];
  chat: ChatMessage[];
}

/* ------------------------------------------------------------------ */
/* Extraction candidates (rules engine or LLM, before Evidence Lock)  */
/* ------------------------------------------------------------------ */

/** The strict JSON shape every extractor (rules or LLM) must produce. */
export interface FieldCandidate {
  category: Category;
  label: string;
  value: string;
  normalized_value: string | null;
  page: number;
  line: number;
  source_text: string;
  confidence: number;
  origin?: Engine;
}

export interface RejectedCandidate {
  candidate: FieldCandidate;
  reason: string;
}
