import { ArrowRight, Bot, CalendarClock, Calculator, Check, ClipboardList, Eye, FileDown, FileSearch, Fingerprint, GitCompareArrows, Languages, Layers, ListChecks, Lock, ScanLine, ShieldCheck, Store, UserCheck, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/app/auth';
import { Logo } from '@/components/Logo';
import { cx } from '@/components/ui';

/* ------------------------------------------------------------------ */
/* Animated hero: document lines connected to the cards they produced  */
/* ------------------------------------------------------------------ */

interface Pair {
  line: string;
  mark: string;
  kind: string;
  color: string;
  title: string;
  value: string;
  cite: string;
}

const PAIRS: Pair[] = [
  { line: 'Pay by 15 Oct 2026', mark: '15 Oct 2026', kind: 'Deadline', color: '#8f88ff', title: 'Payment due', value: '15 Oct 2026 · in 9 days', cite: 'p.1 · L3' },
  { line: 'Interest @ 18% per annum will be charged after the due date.', mark: 'Interest @ 18% per annum', kind: 'Obligation', color: '#4ea8ff', title: 'Nexa must pay or incur interest', value: '₹7,237.50 per month of delay', cite: 'p.1 · L13' },
  { line: 'CGST @ 9% ··· 36,000.00 · SGST @ 9% ··· 36,000.00', mark: 'CGST @ 9%', kind: 'Anomaly', color: '#ff5d6c', title: 'CGST + SGST on an inter-state supply', value: 'Delhi (07) → Karnataka (29): should be IGST', cite: 'p.2 · L13' },
  { line: 'Total amount payable ··· ₹4,82,500.00', mark: '₹4,82,500.00', kind: 'Amount', color: '#3ecf8e', title: 'Total ≠ Σ line items + GST', value: 'Expected ₹4,72,000.00 · ₹10,500 gap', cite: 'p.2 · L18' },
];

const PLAIN = ['TAX INVOICE · INV-0423', 'Supplier: Sharma Office Supplies Pvt Ltd · GSTIN 07AAKCS1234M1Z5', 'Buyer: Nexa Technologies · Place of Supply: Karnataka (29)'];

function HeroDemo() {
  const box = useRef<HTMLDivElement>(null);
  const marks = useRef<Array<HTMLSpanElement | null>>([]);
  const cards = useRef<Array<HTMLDivElement | null>>([]);
  const [paths, setPaths] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const setMark = (i: number, el: HTMLSpanElement | null) => {
    marks.current[i] = el;
  };

  useLayoutEffect(() => {
    const measure = () => {
      const b = box.current?.getBoundingClientRect();
      if (!b) return;
      setPaths(
        PAIRS.map((_, i) => {
          const m = marks.current[i]?.getBoundingClientRect();
          const c = cards.current[i]?.getBoundingClientRect();
          if (!m || !c) return '';
          const x1 = m.right - b.left + 4;
          const y1 = m.top + m.height / 2 - b.top;
          const x2 = c.left - b.left - 4;
          const y2 = c.top + c.height / 2 - b.top;
          const dx = Math.max(40, (x2 - x1) / 2);
          return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
        }),
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    if (paused) return undefined;
    const id = setInterval(() => setActive((a) => (a + 1) % PAIRS.length), 2600);
    return () => clearInterval(id);
  }, [paused]);

  return (
    <div ref={box} className="relative grid gap-5 lg:grid-cols-[1.1fr_1fr] lg:gap-16" onMouseLeave={() => setPaused(false)}>
      <div className="relative rounded-md bg-[#fbfaf7] p-5 font-serif text-[13.5px] leading-[2] text-[#232838] shadow-2xl shadow-black/50 sm:p-7">
        <p className="mb-2 font-sans text-[10px] tracking-[0.25em] text-[#8a8f9c]">INVOICE_0423.PDF · EXCERPT</p>
        <p className="font-semibold">{PLAIN[0]}</p>
        <Line pair={PAIRS[0]} i={0} active={active} setMark={setMark} onHover={(i) => { setActive(i); setPaused(true); }} />
        <p>{PLAIN[1]}</p>
        <p>{PLAIN[2]}</p>
        <Line pair={PAIRS[1]} i={1} active={active} setMark={setMark} onHover={(i) => { setActive(i); setPaused(true); }} />
        <p className="mt-2 border-t border-[#e3e1da] pt-2">Subtotal (taxable value) ··· 4,00,000.00</p>
        <Line pair={PAIRS[2]} i={2} active={active} setMark={setMark} onHover={(i) => { setActive(i); setPaused(true); }} />
        <Line pair={PAIRS[3]} i={3} active={active} setMark={setMark} onHover={(i) => { setActive(i); setPaused(true); }} bold />
        <p className="mt-2 rounded-sm border border-dashed border-[#ff9f43] px-2 text-[12px] text-[#b86e00]">HSN / SAC code: not found on any line</p>
      </div>

      <div className="flex flex-col justify-center gap-3">
        {PAIRS.map((p, i) => (
          <div
            key={p.kind}
            ref={(el) => {
              cards.current[i] = el;
            }}
            onMouseEnter={() => {
              setActive(i);
              setPaused(true);
            }}
            className={cx('card cursor-default p-3.5 transition-all duration-300', active === i ? 'translate-x-0 border-line-2 bg-card-2' : 'opacity-70 lg:translate-x-1')}
          >
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 text-xs" style={{ color: p.color }}>
                <span className="size-2 rounded-full" style={{ background: p.color }} /> {p.kind}
              </p>
              <span className="cite text-yellow">↳ {p.cite}</span>
            </div>
            <p className="mt-1 text-[15px] font-semibold">{p.title}</p>
            <p className="text-sm text-muted">{p.value}</p>
          </div>
        ))}
        <div className="card flex items-center justify-between p-3.5 opacity-80">
          <p className="flex items-center gap-2 text-xs text-missing">
            <span className="size-2 rounded-full bg-missing" /> Missing data
          </p>
          <span className="cite text-faint">↳ schema: GST invoice</span>
        </div>
      </div>

      <svg className="pointer-events-none absolute inset-0 hidden h-full w-full overflow-visible lg:block" aria-hidden="true">
        {paths.map((d, i) =>
          d ? (
            <path
              key={`${i}-${active === i ? active : 'x'}`}
              d={d}
              fill="none"
              stroke={PAIRS[i].color}
              strokeWidth={active === i ? 2 : 1}
              strokeOpacity={active === i ? 0.95 : 0.18}
              strokeDasharray={active === i ? 600 : undefined}
              strokeDashoffset={active === i ? 600 : undefined}
              style={active === i ? { animation: 'draw 0.9s ease-out forwards' } : undefined}
            />
          ) : null,
        )}
      </svg>
    </div>
  );
}

function Line({ pair, i, active, setMark, onHover, bold }: { pair: Pair; i: number; active: number; setMark: (i: number, el: HTMLSpanElement | null) => void; onHover: (i: number) => void; bold?: boolean }) {
  const at = pair.line.indexOf(pair.mark);
  const on = active === i;
  return (
    <p className={cx(bold && 'font-semibold')} onMouseEnter={() => onHover(i)}>
      {pair.line.slice(0, at)}
      <span
        ref={(el) => setMark(i, el)}
        className={cx('rounded-[3px] px-0.5 transition-all duration-300', on && 'animate-pulse-box')}
        style={{ background: `color-mix(in srgb, ${pair.color} ${on ? 30 : 14}%, transparent)`, boxShadow: on ? `inset 0 0 0 1.5px ${pair.color}` : undefined, '--hl': pair.color } as CSSProperties}
      >
        {pair.mark}
      </span>
      {pair.line.slice(at + pair.mark.length)}
    </p>
  );
}

/* ------------------------------------------------------------------ */

const FEATURES: Array<{ icon: ReactNode; title: string; body: string }> = [
  { icon: <Lock className="size-4" />, title: 'Evidence Lock', body: 'Every field’s quote is checked against the OCR text at its page and line. No match, no output.' },
  { icon: <Layers className="size-4" />, title: 'Deterministic anomaly engine', body: 'Totals, GST rates, CGST/SGST vs IGST, GSTIN check digits, PAN format, dates, duplicates, amount in words.' },
  { icon: <ListChecks className="size-4" />, title: 'Missing-data checklist', body: 'Required fields per document type, with a completeness score out of 100.' },
  { icon: <FileSearch className="size-4" />, title: 'Three-way match', body: 'PO vs invoice vs delivery note, line by line, with a citation from all three.' },
  { icon: <ShieldCheck className="size-4" />, title: 'Trust score', body: 'A 0–100 ring per document. Click it to see exactly where every point went.' },
  { icon: <Bot className="size-4" />, title: 'Ask the document', body: 'English or Hindi. Every answer cites its lines, or says it couldn’t find it.' },
  { icon: <CalendarClock className="size-4" />, title: 'Deadline radar', body: 'Calendar of every obligation, overdue in red, one-click .ics export.' },
  { icon: <Calculator className="size-4" />, title: 'Penalty calculator', body: '“If paid on 30 Nov, penalty = ₹3,000”, read straight from the late-fee clause.' },
  { icon: <GitCompareArrows className="size-4" />, title: 'Contract version diff', body: '“Payment term changed from 30 to 15 days (p.3 · L2)”.' },
  { icon: <Fingerprint className="size-4" />, title: 'Tamper check', body: 'SHA-256 of every upload. Same name, different bytes: you are warned.' },
  { icon: <Eye className="size-4" />, title: 'Privacy mode', body: 'PAN, Aadhaar, bank and phone numbers are masked before text reaches the LLM.' },
  { icon: <UserCheck className="size-4" />, title: 'Human-in-the-loop', body: 'Reviewers approve, reject or correct fields; every edit is kept.' },
  { icon: <FileDown className="size-4" />, title: 'Evidence Pack', body: 'One PDF with every finding, its citation and a crop of the source line.' },
  { icon: <Store className="size-4" />, title: 'Vendor risk', body: 'Documents grouped by vendor with anomaly counts and a risk score.' },
  { icon: <ClipboardList className="size-4" />, title: 'Audit trail', body: 'Uploads, extractions, rejections, reviews and exports, timestamped.' },
  { icon: <ScanLine className="size-4" />, title: 'OCR for scans', body: 'Scanned PDFs and phone photos read in-browser with Tesseract (English + Hindi).' },
];

export default function Landing() {
  const { status, user, signOut } = useAuth();
  const signedIn = status === 'signedIn';

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Logo />
        <nav className="flex items-center gap-1 text-sm sm:gap-2">
          <a href="#how" className="hidden rounded-lg px-3 py-2 text-muted hover:text-ink sm:block">
            How it works
          </a>
          <a href="#features" className="hidden rounded-lg px-3 py-2 text-muted hover:text-ink sm:block">
            Features
          </a>
          {signedIn ? (
            <>
              <span className="hidden max-w-48 truncate px-2 text-faint md:block" title={user?.email}>
                {user?.email}
              </span>
              <button type="button" onClick={() => void signOut()} className="rounded-lg px-3 py-2 text-muted hover:text-ink">
                Sign out
              </button>
              <Link to="/dashboard" className="rounded-lg bg-yellow px-3.5 py-2 font-semibold text-navy hover:bg-[#ffdf6b]">
                Open dashboard
              </Link>
            </>
          ) : (
            <>
              <Link to="/login" className="rounded-lg px-3 py-2 text-muted hover:text-ink">
                Sign in
              </Link>
              <Link to="/login" className="rounded-lg bg-yellow px-3.5 py-2 font-semibold text-navy hover:bg-[#ffdf6b]">
                Try the demo
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-5 pt-10 pb-20 sm:pt-16">
        <p className="cite text-faint">↳ Zero Origin Hackathon 2026 · Team Binary Beasts</p>
        <h1 className="mt-4 max-w-4xl text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-6xl">
          Every number, pinned to <span className="mark text-ink">the line it came from.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted">
          DocTrace AI reads invoices, contracts and purchase orders. It pulls out deadlines, amounts, obligations and anomalies, and refuses to show you anything it can’t cite to an exact page and line.
        </p>
        <p className="mt-4 font-serif text-2xl text-yellow italic">No source, no output.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to={signedIn ? '/dashboard' : '/login'} className="inline-flex h-12 items-center gap-2 rounded-lg bg-yellow px-6 font-semibold text-navy hover:bg-[#ffdf6b]">
            {signedIn ? 'Open your dashboard' : 'Try the demo account'} <ArrowRight className="size-4" />
          </Link>
          {!signedIn && (
            <Link to="/signup" className="inline-flex h-12 items-center rounded-lg border border-line-2 px-6 hover:border-muted">
              Create an account
            </Link>
          )}
        </div>
        <div className="mt-16">
          <HeroDemo />
        </div>
      </section>

      <section id="how" className="border-y border-line bg-navy-2">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-3xl font-semibold tracking-tight">How a document becomes evidence</h2>
          <ol className="mt-10 grid gap-px overflow-hidden rounded-[10px] border border-line bg-line md:grid-cols-4">
            {[
              { n: '01', t: 'Read', b: 'pdf.js reads the text layer. Scans and photos go through OCR. Every line gets a page, a number and a box.', ex: 'p2-L18 · bbox 0.39,0.62' },
              { n: '02', t: 'Extract', b: 'A rules engine and an LLM both return the same strict JSON: label, value, page, line, source text, confidence.', ex: '{ "page": 2, "line": 18, … }' },
              { n: '03', t: 'Verify', b: 'The Evidence Lock fuzzy-matches each quote against that exact line. Anything that fails is discarded and logged.', ex: 'rejected: no evidence' },
              { n: '04', t: 'Show', b: 'Click any card to jump to the highlighted line. Click a highlight to open its card.', ex: '↳ p.2 · L18' },
            ].map((s) => (
              <li key={s.n} className="bg-navy-2 p-6">
                <p className="font-mono text-sm text-yellow">{s.n}</p>
                <p className="mt-2 text-lg font-semibold">{s.t}</p>
                <p className="mt-2 text-sm text-muted">{s.b}</p>
                <p className="cite mt-4 text-faint">{s.ex}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-20 lg:grid-cols-2">
        <div>
          <p className="label">The Evidence Lock</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">LLMs make things up. DocTrace checks.</h2>
          <p className="mt-4 text-muted">
            After extraction, a second, deterministic step looks for each quoted sentence in the OCR text at the cited page and line. A made-up amount, a clause that isn’t there, a wrong page: all discarded before you ever see them. You get a running count, and every rejection is in the audit trail.
          </p>
        </div>
        <div className="card p-5 font-mono text-[12.5px] leading-6">
          <p className="mb-2 font-sans text-sm">
            <b>37</b> fields extracted, <b className="text-anomaly">3</b> discarded for missing evidence
          </p>
          {[
            { ok: true, t: 'Total = ₹4,82,500.00', w: 'quote found at p.2 · L18 (100%)' },
            { ok: true, t: 'Payment due = 2026-10-15', w: 'quote found at p.1 · L3 (100%)' },
            { ok: false, t: 'Cancellation fee = 25%', w: 'quote not found at p.3 · L9 (41%)' },
            { ok: false, t: 'Total = ₹5,00,000.00', w: 'value not in the quoted text' },
            { ok: false, t: 'Due date = 2026-11-01', w: 'p.6 does not exist' },
          ].map((r) => (
            <p key={r.t} className="flex flex-wrap items-start gap-x-2 border-b border-line/60 py-1 last:border-0 sm:flex-nowrap">
              {r.ok ? <Check className="mt-1 size-3.5 shrink-0 text-amount" /> : <X className="mt-1 size-3.5 shrink-0 text-anomaly" />}
              <span className={r.ok ? 'text-ink' : 'text-muted line-through decoration-anomaly/60'}>{r.t}</span>
              <span className="w-full pl-5.5 text-faint sm:ml-auto sm:w-auto sm:pl-3 sm:text-right">{r.w}</span>
            </p>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-5 pb-20">
        <h2 className="text-3xl font-semibold tracking-tight">Everything a reviewer needs, nothing they can’t verify</h2>
        <div className="mt-10 grid overflow-hidden rounded-[10px] border border-line sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="border-b border-line p-5 sm:border-r [&:nth-child(2n)]:sm:border-r-0 lg:[&:nth-child(2n)]:border-r lg:[&:nth-child(4n)]:border-r-0">
              <p className="flex items-center gap-2 font-semibold">
                <span className="text-yellow">{f.icon}</span> {f.title}
              </p>
              <p className="mt-1.5 text-sm text-muted">{f.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 flex items-center gap-2 text-sm text-faint">
          <Languages className="size-4" /> Interface and chat in English and हिन्दी.
        </p>
      </section>

      <section className="border-t border-line bg-navy-2">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 py-16 md:flex-row md:items-center">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">See it on real documents.</h2>
            <p className="mt-1 text-muted">The demo account comes with an invoice, a contract and a purchase order, each with problems to find.</p>
          </div>
          <Link to={signedIn ? '/dashboard' : '/login'} className="inline-flex h-12 items-center gap-2 rounded-lg bg-yellow px-6 font-semibold text-navy hover:bg-[#ffdf6b]">
            {signedIn ? 'Open dashboard' : 'Try the demo account'} <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-faint sm:flex-row sm:items-center sm:justify-between">
          <p>
            Built by <span className="text-ink">Team Binary Beasts</span> · Zero Origin Hackathon 2026
          </p>
          <p>Prakhar Porwal · Piyush Kumar · Prince Kumar · Tanay Marudkar</p>
        </div>
      </footer>
    </div>
  );
}
