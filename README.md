# DocTrace AI

**No source, no output.**

DocTrace AI reads invoices, contracts, purchase orders and delivery notes, and extracts deadlines, obligations, anomalies, missing data and financial values. Every output is traced back to the exact **page, line and region** of the source document, and anything the system can't cite is thrown away.

Built by **Team Binary Beasts** for the **Zero Origin Hackathon 2026**.

- **Frontend:** React 19 + TypeScript + Tailwind CSS 4 (Vite)
- **Backend:** Supabase (Postgres, Auth, Storage, Row Level Security)
- **AI:** Gemini or OpenAI, called only from Netlify Functions (the key never reaches the browser)
- **PDF:** pdf.js · **OCR:** Tesseract.js (English + Hindi, self-hosted) · **Charts:** Recharts · **Icons:** lucide-react

---

## Quick start (no accounts needed)

```bash
npm install
npm run dev            # http://localhost:5173
```

Click **Try Demo Account**. With no Supabase keys the app runs in **offline demo mode**: the same features, with accounts and documents stored in your browser (IndexedDB). The demo account is seeded on first sign-in with:

| File | Type | What it shows | Trust |
|---|---|---|---|
| `invoice_0423.pdf` (2 pages) | Invoice | `Pay by 15 Oct 2026` at **p.1 · L3**; total ₹4,82,500.00 at **p.2 · L18** vs ₹4,72,000.00 computed (**₹10,500 gap**); CGST + SGST on an inter-state supply; HSN codes and signature missing | **58** |
| `service_agreement_nexa.pdf` (4 pages) | Contract | CloudServe's monthly uptime report by the 5th; Nexa pays ₹1,50,000 per quarter within 30 days; 2% per month late fee; auto-renewal on 31 Dec 2026 with a **1 Dec 2026** notice deadline | **86** |
| `purchase_order_PO-7781.pdf` | Purchase order | Linked to INV-0423; monitors at ₹1,00,000 vs ₹1,25,000 invoiced (**₹25,000 rate mismatch**) | **92** |

It also seeds 2 vendors, 8 audit entries, a reviewer correction, and 3 cited chat Q&As (one in Hindi). The trust scores aren't hard-coded: they come out of the formula below.

More samples are one click away in the upload window: a delivery note (completes the three-way match), a revised contract (for the diff), an edited copy of the invoice (triggers the tamper check) and a scanned PNG (exercises OCR).

---

## Features

### Core
- **Upload** PDF, DOCX, JPG or PNG (max 20 MB) with a live pipeline: Uploading → OCR → Extracting → Verifying → Done.
- **Split-screen viewer**: the document on the left with coloured highlight boxes (deadline purple, amount green, anomaly red, obligation blue, missing orange). Click a card and the viewer scrolls to the line and pulses it; click a highlight and its card opens.
- **Extraction** of deadlines, amounts (subtotal, taxes, total, penalties), obligations, parties, invoice/PO numbers, GSTIN and PAN.
- **Every card** shows the value, a citation (`↳ p.2 · L18`), the exact source sentence and a confidence bar.

### What makes it different
1. **Evidence Lock.** Every field, from the rules engine or the LLM, must quote text that really exists at its page and line (fuzzy-matched, so OCR noise is tolerated). A wrong line, a missing page, an invented clause or a real quote paired with a made-up value is discarded and logged as `rejected: no evidence`. Each document shows *"N fields extracted, M discarded for missing evidence"*. **Stress-test** on any document feeds the lock four fabricated fields so you can watch it reject them.
2. **Deterministic Anomaly Engine** (plain code, no AI): total ≠ Σ line items + tax · subtotal ≠ Σ line items · qty × rate ≠ amount · GST ≠ stated rate × taxable value · CGST + SGST on an inter-state supply (or IGST on an intra-state one), from the GSTIN state codes · invalid GSTIN check digit · invalid PAN format · PAN ≠ GSTIN · due date before invoice date · duplicate invoice number across your documents · amount in words ≠ figures · party name mismatch · risky contract clauses. Every anomaly has a **"Why was this flagged?"** panel with the rule, the expected and found values, the source line and the related lines checked.
3. **Missing Data Checklist** per document type (GST invoice, contract, PO, delivery note) with a weighted **completeness score out of 100**.
4. **Three-Way Match**: PO vs invoice vs delivery note, line by line, with citations into all three documents and the money at stake.
5. **Trust Score** (0–100 ring). Click it for the exact breakdown: high anomaly −15, medium −7, low −3; missing high-priority field −8, medium −5, low −2; confidence −40 × (1 − average).
6. **Ask-the-Document** chat in English or Hindi. Answers carry clickable citations; citations are re-verified by the Evidence Lock, and when the answer isn't in the document the reply is *"I couldn't find this in the document."*
7. **Deadline Radar**: calendar and timeline of every obligation (recurring ones expanded), overdue in red, a next-7-days view, and **Export to Google Calendar (.ics)**.
8. **Penalty Calculator** that reads late-fee clauses ("2% per month", "18% per annum", "₹500 per day", "or part thereof"): *If paid on [date], penalty = ₹X*.
9. **Contract Version Diff**: clauses aligned by number, word-level changes, and a summary like *"Payment term changed from 30 to 15 days (p.3 · L2)"*.
10. **Tamper Check**: SHA-256 of every upload. Same file name with different bytes gives *"This document has been modified since the original upload."* Identical bytes are recognised as a duplicate and not processed twice.
11. **Privacy Mode**: PAN, Aadhaar, bank account, phone numbers and email names are masked before any text is sent to the LLM. Masks keep the same length, so citations still line up.
12. **Human-in-the-loop review**: reviewers approve, reject or correct fields; corrections are kept in an edit history. Uploaders can read but not review, and that rule is enforced in the database too.
13. **Evidence Pack export**: a PDF audit report with every finding, its citation and a cropped screenshot of the highlighted source line.
14. **Vendor Risk Profile**: documents grouped by vendor with anomaly counts and an explained risk score.
15. **Audit trail** of uploads, extractions, Evidence Lock rejections, reviews, chats and exports, with timestamps and CSV export.

**Also:** English/Hindi interface labels, profile with avatar and organisation, roles (Uploader / Reviewer), skeleton loaders, empty states, friendly error messages, toasts, error boundaries, and a fully responsive layout.

---

## How it works

```
File ─► Ingest ────────────────► Extract ─────────────► Evidence Lock ──► Checks ─────────────► Store
        pdf.js text layer         rules engine (always)  quote must exist   anomalies (rules)     Supabase (RLS)
        Tesseract OCR (scans)     + LLM via /api/extract at page + line     missing-data          or IndexedDB
        mammoth (DOCX)            same strict JSON shape  else discarded     obligations, trust
        → lines with page,
          line number and bbox
```

Every extractor returns the same strict JSON per field:

```json
{ "category": "amount", "label": "Total", "value": "₹4,82,500.00", "normalized_value": "482500.00",
  "page": 2, "line": 18, "source_text": "Total amount payable ₹4,82,500.00", "confidence": 0.97 }
```

The server function validates the model's JSON (bad shapes are dropped). The browser then verifies every quote against the document text before anything is saved.

### Code map

```
src/
  lib/engine/      deterministic core: facts, extract, evidence (Evidence Lock), anomalies,
                   missing, trust, obligations, penalty, threeway, diff, privacy, ics, qa
  lib/ingest/      pdf.js text + OCR (Tesseract) + DOCX → lines with bounding boxes
  lib/pipeline/    processDocument(): the whole analysis, pure and synchronous
  lib/data/        Repo interface → SupabaseRepo (cloud) and LocalRepo (IndexedDB)
  lib/services/    upload pipeline, demo seed, vendors
  lib/pdfgen/      sample documents + jsPDF generator (embedded DejaVu fonts for ₹)
  lib/report.ts    Evidence Pack PDF
  pages/           Landing, Login, Dashboard, Documents, DocumentDetail, ThreeWay, Radar,
                   Compare, Vendors, Audit, Settings
netlify/functions/ health, extract, chat (LLM calls, server side only)
supabase/          migration (schema + RLS + storage) and its tests
scripts/           seed.ts, copy-ocr-assets.mjs
```

---

## Cloud setup (Supabase + AI)

### 1. Supabase
1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste [`supabase/migrations/20261006000000_init.sql`](supabase/migrations/20261006000000_init.sql) and run it. It creates all tables, the Row Level Security policies, the profile trigger and the private `documents` storage bucket. It is safe to run again.
3. **Project Settings → API**: copy the Project URL, the `anon` key and the `service_role` key.
4. Optional: to enable **Google login**, go to **Authentication → Providers → Google**, add your Google OAuth client ID and secret, and add your site URL (e.g. `https://your-site.netlify.app`) under **Authentication → URL Configuration** (Site URL and redirect URLs).

### 2. Environment variables
Copy `.env.example` to `.env` and fill it in:

| Variable | Where | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | browser + Netlify | Supabase project URL. Empty = offline demo mode |
| `VITE_SUPABASE_ANON_KEY` | browser + Netlify | Supabase anon (public) key. Safe in the browser because RLS protects the data |
| `GEMINI_API_KEY` *or* `OPENAI_API_KEY` | Netlify only | Enables LLM extraction and chat. Without it, the rules engine and offline Q&A are used |
| `GEMINI_MODEL` / `OPENAI_MODEL` | Netlify only | Optional; defaults to `gemini-2.5-flash` / `gpt-4o-mini` |
| `LLM_PROVIDER` | Netlify only | Optional; `gemini` or `openai` when both keys are set |
| `REQUIRE_AUTH` | Netlify only | Optional; `true` makes the AI endpoints require sign-in even without Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | **your machine only** | Used only by `npm run seed`. Never put it in Netlify or the browser |

When Supabase is configured, the AI functions only serve signed-in users: the browser sends its Supabase access token and the function verifies it. That stops strangers from spending your LLM quota.

### 3. Seed the demo account
```bash
npm run seed
```
This creates (or resets) `demo@doctrace.ai` / `Demo@1234` and loads the sample documents **while signed in as that user**, so the data goes through the same RLS policies as the app. If you skip this step, **Try Demo Account** creates and seeds the user on first click, as long as email confirmation is turned off in Supabase.

---

## Deploy on Netlify

1. Push this repository to GitHub.
2. In Netlify: **Add new project → Import an existing project → GitHub →** this repo. `netlify.toml` sets everything: build `npm run build`, publish `dist`, functions in `netlify/functions`, Node 22, and the SPA fallback.
3. **Project configuration → Environment variables**: add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and one of `GEMINI_API_KEY` / `OPENAI_API_KEY`. (Skip all of them to deploy in offline demo mode, which works immediately.)
4. Deploy. Check **Settings** in the app: it shows whether storage is Supabase or the browser, and which AI model (if any) the server has.
5. Make sure **Visitor access** does not require a Netlify login, or judges won't be able to open the site.

The OCR engine and its English + Hindi language data (~16 MB) are copied from `node_modules` into `public/tesseract` at build time and served from your own domain. No third-party CDN is involved.

**Function timeouts:** Netlify's default synchronous limit is about 10 s on the free plan. The AI calls use fast models and fall back to the rules engine on a timeout, so uploads never fail because the model was slow. If `/api/health` ever returns the HTML page instead of JSON, the app treats AI as off and keeps working.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server. For the AI functions locally use `npx netlify dev` |
| `npm run build` | Type-check + production build into `dist/` |
| `npm test` | 61 tests: engine rules, Evidence Lock, PDF round-trip with real pdf.js, demo seed, pipeline with LLM output, Netlify functions (mocked LLM), and the SQL migration + RLS in an embedded Postgres (PGlite) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run seed` | Seed the Supabase demo account |

---

## Security notes

- **RLS everywhere.** Every table is scoped to `auth.uid()` directly or through the owning document. Storage objects live under `<user_id>/…`. The tests in `supabase/schema.test.ts` prove a second user can't read or write the first user's rows or files.
- **Reviewer-only review.** Changing an extracted field's review status is allowed only for profiles with `role = 'reviewer'`. Users can change their own role in Settings, which is fine for a hackathon demo; in production, assign roles from an admin tool instead.
- **LLM keys stay on the server.** Inputs are size-limited and rate-limited per IP, and the output is validated.
- **Offline mode** hashes local passwords with PBKDF2 (WebCrypto). It exists for demos, not as a production auth system.

---

## Team Binary Beasts

Prakhar Porwal · Piyush Kumar · Prince Kumar · Tanay Marudkar
