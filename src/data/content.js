// All copy on the site comes from the DocTrace AI pitch deck (Team Binary Beasts).

export const NAV = [
  { id: 'problem', label: 'Problem' },
  { id: 'solution', label: 'Solution' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'traceability', label: 'Traceability' },
  { id: 'checks', label: 'Checks' },
  { id: 'demo', label: 'Live demo' },
  { id: 'compare', label: 'Compare' },
  { id: 'roadmap', label: 'Roadmap' },
  { id: 'team', label: 'Team' },
];

export const HERO = {
  eyebrow: 'Problem statement · Intelligent business document analysis',
  title: 'DocTrace AI',
  description:
    'An explainable AI system that extracts deadlines, obligations, anomalies, missing data and financial values from business documents, with every output traced back to the exact line it came from.',
  tagline: 'No source, no output.',
  team: 'Team Binary Beasts',
  event: 'Zero Origin Hackathon 2026',
  card: {
    file: 'invoice_0423.pdf',
    rows: [
      { tag: 'Deadline', value: 'Pay by 15 Oct 2026', source: 'p.1 · L3', tone: 'yellow' },
      { tag: 'Amount', value: '₹4,82,500.00', source: 'p.2 · L18', tone: 'teal' },
      { tag: 'Anomaly', value: 'Total ≠ Σ line items', source: 'p.2 · Table 1', tone: 'coral' },
    ],
  },
};

export const PROBLEM = {
  kicker: '01 · The problem',
  title: 'Critical business facts are buried in unstructured documents',
  cards: [
    { icon: 'clock', title: 'Slow manual review', text: 'Analysts read invoices and contracts line by line: hours per document, and error-prone at scale.' },
    { icon: 'calendar', title: 'Missed deadlines', text: 'Renewal, notice and payment dates hide in clauses. One miss means penalties or auto-renewals.' },
    { icon: 'alert', title: 'Hidden anomalies', text: 'Duplicate invoices, tax miscalculations and overbilling slip past tired human eyes.' },
    { icon: 'box', title: 'Black-box AI', text: 'Existing AI tools answer without proof. Auditors and lawyers cannot act on an answer they cannot verify.' },
  ],
  quote: 'Extraction alone is not enough. In finance, legal and compliance, an answer is only useful if you can prove where it came from.',
  docs: ['Invoices', 'Contracts', 'Reports', 'Compliance'],
  gap: 'Explainable, source-traceable document intelligence',
};

export const SOLUTION = {
  kicker: '02 · Proposed solution',
  title: 'DocTrace AI: read, extract, verify, and show the proof',
  inputs: ['PDFs & scanned copies', 'Images & phone photos', 'DOCX & email attachments', 'Excel / CSV reports'],
  engine: ['OCR · Layout AI', 'LLM · Rules'],
  outputs: [
    { label: 'Deadlines', source: 'p.6 · cl.7.2' },
    { label: 'Obligations', source: 'p.3 · cl.4.1' },
    { label: 'Anomalies', source: 'p.2 · Table 1' },
    { label: 'Missing data', source: 'schema: PO no.' },
    { label: 'Financial values', source: 'p.2 · L18' },
  ],
  pillars: [
    { icon: 'cpu', title: 'Hybrid AI', text: 'Layout AI + LLM + rule validators' },
    { icon: 'link', title: 'Source-verified', text: 'Every value cites its page & quote' },
    { icon: 'layers', title: '4-layer checks', text: 'Math, consistency, cross-doc, ML' },
    { icon: 'user', title: 'Human-in-the-loop', text: 'One-click review; learns from edits' },
  ],
};

export const ARCHITECTURE = {
  kicker: '03 · Architecture & tech stack',
  title: 'End-to-end pipeline with verification built in',
  steps: [
    { n: '01', title: 'Ingest', items: ['Upload / REST API', 'Email & Drive import', 'File-type check'] },
    { n: '02', title: 'Pre-process', items: ['OCR (PaddleOCR)', 'De-skew, denoise', 'Layout blocks + IDs'] },
    { n: '03', title: 'Understand', items: ['Classify doc type', 'Section chunking', 'Embeddings'] },
    { n: '04', title: 'Extract', items: ['LLM → JSON schema', 'NER + regex', 'Cites span IDs'] },
    { n: '05', title: 'Verify', items: ['Quote ↔ OCR match', 'Rules engine', 'Anomaly model'] },
    { n: '06', title: 'Deliver', items: ['Dashboard', 'Alerts & calendar', 'JSON / Excel / API'] },
  ],
  dataLayer: ['Object store · raw files', 'PostgreSQL · fields + citations', 'Vector DB · semantic search', 'Audit log · every action'],
  stack: ['React', 'FastAPI', 'PaddleOCR', 'LayoutLMv3', 'Llama 3 / Gemini', 'PostgreSQL', 'ChromaDB', 'Docker'],
};

export const TRACE = {
  kicker: '04 · Our core innovation',
  title: 'Traceability: no source, no output',
  doc: {
    heading: 'MASTER SERVICES AGREEMENT',
    page: 'Page 6 of 14',
    clauses: [
      { id: '7.1', text: 'This Agreement shall renew automatically for successive one-year terms commencing 1 April 2027.' },
      { id: '7.2', text: 'Either party may terminate this Agreement by giving sixty (60) days’ written notice prior to the renewal date.', highlight: 'giving sixty (60) days’ written notice' },
      { id: '7.3', text: 'All undisputed invoices shall be payable within thirty (30) days of receipt.' },
    ],
  },
  json: {
    type: 'deadline',
    label: 'Termination notice due',
    value: '2027-01-31',
    derived: 'renewal 2027-04-01 − 60 days',
    source: { file: 'MSA_Vendor.pdf', page: 6, clause: '7.2', bbox: [72, 410, 540, 452], quote: 'giving sixty (60) days’ written notice' },
    confidence: 0.96,
  },
  steps: [
    { n: 1, title: 'Cite', text: 'The LLM must return the text-block IDs it read from. No ID, no answer.' },
    { n: 2, title: 'Verify', text: 'The quote is fuzzy-matched to the OCR text; a mismatch means the result is rejected.' },
    { n: 3, title: 'Show', text: 'Click any result to jump to the highlighted line in the original file.' },
  ],
};

export const CHECKS = {
  kicker: '05 · Anomaly & missing-data engine',
  title: 'Four layers of checks catch what humans miss',
  layers: [
    { icon: 'calc', title: 'Arithmetic', items: ['Σ line items ≠ invoice total', 'GST % × taxable value ≠ tax', 'Amount in words ≠ figures'] },
    { icon: 'check', title: 'Consistency', items: ['Due date earlier than issue date', 'Party names differ across pages', 'Contract dates out of sequence'] },
    { icon: 'files', title: 'Cross-document', items: ['Duplicate invoice numbers', 'Invoice rate ≠ PO / contract rate', 'Same bill paid twice'] },
    { icon: 'chart', title: 'Statistical AI', items: ['Price spike vs vendor history (Isolation Forest)', 'Unusual clauses: auto-renewal, unlimited liability'] },
  ],
  schema: {
    name: 'GST invoice schema',
    fields: [
      { label: 'Invoice number', ok: true },
      { label: 'Supplier GSTIN', ok: true },
      { label: 'Invoice date', ok: true },
      { label: 'PO reference', ok: false },
      { label: 'HSN / SAC code', ok: true },
      { label: 'Authorised signature', ok: false },
    ],
  },
  severities: ['HIGH', 'MEDIUM', 'LOW'],
};

export const DEMO = {
  kicker: '06 · Prototype UI',
  title: 'Reviewer dashboard: findings beside their proof',
  intro:
    'This is a working prototype, not a mock-up. Load the sample documents or drop in your own PDF, DOCX, CSV or TXT file. Everything runs in your browser; nothing is uploaded anywhere.',
};

// ✓ supported · ◐ partial / slow · ✗ not supported · null = N/A
export const COMPARE = {
  kicker: '07 · Why DocTrace AI',
  title: 'How we compare with existing approaches',
  columns: ['Manual review', 'OCR tools', 'Generic AI chat', 'DocTrace AI'],
  rows: [
    { label: 'Structured field extraction', values: ['no', 'partial', 'partial', 'yes'] },
    { label: 'Clause-level source citations', values: ['partial', 'no', 'no', 'yes'] },
    { label: 'Anomaly & missing-data detection', values: ['partial', 'no', 'no', 'yes'] },
    { label: 'Cross-document checks', values: ['partial', 'no', 'no', 'yes'] },
    { label: 'Deadline tracking & alerts', values: ['no', 'no', 'no', 'yes'] },
    { label: 'Hallucination guard (verified quotes)', values: [null, null, 'no', 'yes'] },
    { label: 'Speed at scale', values: ['no', 'yes', 'yes', 'yes'] },
  ],
};

export const IMPACT = {
  kicker: '08 · Impact & roadmap',
  title: 'Faster decisions, fewer penalties, and where we go next',
  stats: [
    { value: 'Minutes', label: 'not hours, to review a contract (target)' },
    { value: 'Zero', label: 'missed renewal or payment deadlines: our goal' },
    { value: '100%', label: 'of findings traceable to source text' },
    { value: '24 × 7', label: 'automated monitoring of every document' },
  ],
  beneficiaries: ['MSMEs & startups', 'CA & audit firms', 'Legal & procurement teams', 'Government compliance cells'],
  roadmap: [
    { n: 1, title: 'Hackathon MVP', when: 'Now', items: ['Invoices + contracts', 'Traceable extraction'] },
    { n: 2, title: 'Pilot', when: 'Month 1–2', items: ['CA firm / college office', 'Tune with feedback'] },
    { n: 3, title: 'Multilingual', when: 'Month 3–4', items: ['Hindi & regional OCR', 'Handwritten fields'] },
    { n: 4, title: 'Integrations', when: 'Month 5–6', items: ['Tally, Zoho, SAP', 'Gmail & Drive sync'] },
    { n: 5, title: 'Predictive risk', when: 'Year 2', items: ['Contract risk scoring', 'Cash-flow forecast'] },
  ],
};

export const TEAM = {
  title: 'Thank you',
  line: 'Trust every number, because you can see exactly where it came from.',
  tagline: 'No source, no output.',
  name: 'Team Binary Beasts',
  members: [
    { initials: 'PP', name: 'Prakhar Porwal', role: 'Member 01' },
    { initials: 'PK', name: 'Piyush Kumar', role: 'Member 02' },
    { initials: 'PK', name: 'Prince Kumar', role: 'Member 03' },
    { initials: 'TM', name: 'Tanay Marudkar', role: 'Member 04' },
  ],
};
