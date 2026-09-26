# DocTrace AI

**Intelligent Business Document Analysis. No source, no output.**

DocTrace AI extracts deadlines, obligations, anomalies, missing data and financial
values from business documents, and traces every output back to the exact line it
came from. Built by **Team Binary Beasts** for the **Zero Origin Hackathon 2026**.

This repository contains the project website: every section of the pitch deck,
plus a **working live demo** of the DocTrace engine that runs entirely in the
browser. Files are never uploaded anywhere.

## What the live demo does

| Pipeline step | In this prototype |
|---|---|
| **Ingest** | Drag & drop or browse: PDF (with a text layer), DOCX, CSV/TSV, TXT, or pasted text. Size, type and count limits come with clear error messages. |
| **Pre-process** | PDF text is rebuilt into lines (pdf.js); every line gets a stable ID such as `p2-L18`. |
| **Understand** | Classifies each file as an invoice, contract, report or compliance document. |
| **Extract** | Deadlines (including derived ones such as *renewal − 60 days notice*), obligations, financial values, invoice fields and line items. |
| **Verify** | Every finding's quote is matched against the line it cites. Anything that fails is **rejected**. |
| **Deliver** | Reviewer dashboard: click a finding to jump to the highlighted line. Export to JSON or CSV. |

### Four layers of checks

1. **Arithmetic**: qty × rate ≠ amount, Σ line items ≠ subtotal, GST % × taxable value ≠ tax, total ≠ its parts, amount in words ≠ figures (lakh/crore aware).
2. **Consistency**: due date before invoice date, GSTIN check-digit failures, party names that differ, contract dates out of sequence.
3. **Cross-document**: duplicate invoice numbers, the same bill paid twice, invoice rate ≠ contract rate.
4. **Statistical**: price spikes against vendor history (robust z-score, needs 4+ invoices from one vendor), plus unusual clauses (auto-renewal, unlimited liability, one-sided changes, penalties, indemnity).

**Missing-data check**: GST invoice and contract schemas (invoice number, GSTIN, PO reference, HSN/SAC, signature, governing law, and so on).

Click **Load sample documents** in the demo to see all of this on four sample files.

## Getting started

You need Node.js 20.19 or newer.

```bash
npm install
npm run dev      # start the dev server at http://localhost:5173
npm test         # run the engine's unit tests (Vitest)
npm run lint     # ESLint
npm run build    # production build in dist/
npm run preview  # serve the production build
```

The build uses relative paths, so the `dist/` folder can be hosted anywhere:
GitHub Pages, Netlify, Vercel, or any static file server.

## Project structure

```
src/
  data/content.js        all copy from the pitch deck
  data/samples.js        sample invoices + contract for the demo
  engine/                the DocTrace engine (plain JS, no UI)
    document.js          document model: pages, lines, line IDs
    parsers.js           PDF / DOCX / CSV / TXT ingest + error handling
    money.js, dates.js, words.js   number, date and amount-in-words parsing
    fields.js            classification and field extraction
    checks.js            the four layers of checks + missing-data schemas
    analyze.js           orchestration, deadlines, obligations, verification
    engine.test.js       unit tests
  components/            one React component per website section
  components/demo/       the live review workspace
```

## Error handling

- Unsupported, empty, oversized, password-protected, corrupt or scanned (no text layer) files each get a specific message. The other files in the batch still load.
- A crash while analysing one document is reported for that document only.
- Error boundaries keep a broken widget from blanking the page.
- CSV export guards against spreadsheet formula injection.

## Roadmap (from the deck)

The planned production stack is React, FastAPI, PaddleOCR, LayoutLMv3, Llama 3 / Gemini,
PostgreSQL, ChromaDB and Docker. Next steps: OCR for scans and phone photos, an LLM
extraction step that must cite line IDs (checked by the same verifier), a pilot with a
CA firm, Hindi and regional OCR, then Tally / Zoho / SAP integrations and predictive risk scoring.

## Team Binary Beasts

Prakhar Porwal · Piyush Kumar · Prince Kumar · Tanay Marudkar
