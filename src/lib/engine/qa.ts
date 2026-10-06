// Ask-the-Document, offline version. Used when no LLM key is configured, and
// as the safety net when the LLM's citations fail the Evidence Lock.
// It ranks lines by keyword relevance and answers only from those lines.

import type { Citation, Lang, ParsedPage } from '../types';
import { findDates, formatDate } from './dates';
import { spanBox } from './evidence';
import { findCurrencyAmounts, formatINR } from './money';
import { tokens } from './text';

export const NOT_FOUND = {
  en: "I couldn't find this in the document.",
  hi: 'मुझे यह जानकारी दस्तावेज़ में नहीं मिली।',
};

export interface QAResult {
  answer: string;
  citations: Citation[];
  found: boolean;
}

// Hindi words -> English search terms (plus intent markers).
const HI: Record<string, string[]> = {
  भुगतान: ['pay', 'payment', 'payable'], कब: ['@date'], तारीख: ['date', '@date'], तिथि: ['date', '@date'], दिनांक: ['date', '@date'],
  अंतिम: ['due', 'last'], देय: ['due', 'payable'], राशि: ['amount', '@amount'], रकम: ['amount', '@amount'], कुल: ['total', '@amount'],
  कितना: ['@amount'], कितनी: ['@amount'], कितने: ['@amount'], जुर्माना: ['penalty', 'late', 'fee', 'interest'], दंड: ['penalty'],
  पेनल्टी: ['penalty', 'late'], विलंब: ['late'], देरी: ['late'], ब्याज: ['interest'], कर: ['tax', 'gst'], टैक्स: ['tax', 'gst'],
  जीएसटी: ['gst', 'cgst', 'sgst', 'igst'], चालान: ['invoice'], इनवॉइस: ['invoice'], बिल: ['invoice', 'bill'], अनुबंध: ['agreement'],
  समझौता: ['agreement'], नवीनीकरण: ['renew', 'renewal'], नोटिस: ['notice'], सूचना: ['notice'], आपूर्तिकर्ता: ['supplier'],
  विक्रेता: ['vendor', 'supplier'], खरीदार: ['buyer'], कौन: ['@party'], रिपोर्ट: ['report'], अपटाइम: ['uptime'], मासिक: ['monthly'],
  हस्ताक्षर: ['signatory', 'signature'], पता: ['address'], मात्रा: ['qty', 'quantity'], दर: ['rate'], लैपटॉप: ['laptops'],
  मॉनिटर: ['monitors'], समाप्ति: ['expire', 'until'], ऑर्डर: ['order', 'po'], डिलीवरी: ['delivery', 'deliver'], नंबर: ['number', 'no'],
  संख्या: ['number', 'no'],
};

const SYN: Record<string, string[]> = {
  due: ['pay', 'by', 'due'], deadline: ['due', 'by', 'notice'], penalty: ['late', 'fee', 'interest', 'penalty'], fine: ['late', 'fee', 'penalty'],
  gst: ['cgst', 'sgst', 'igst', 'gst'], tax: ['cgst', 'sgst', 'igst', 'gst', 'tax'], renew: ['renew', 'renewal', 'automatically'],
  renewal: ['renew', 'automatically'], vendor: ['supplier', 'vendor'], supplier: ['supplier', 'vendor'], total: ['total', 'payable'],
  cost: ['total', 'amount'], price: ['rate', 'amount'], paid: ['pay', 'payment'], payment: ['pay', 'payable'],
  terminate: ['terminate', 'notice'], cancel: ['terminate', 'notice'], uptime: ['uptime', 'report'],
};

function expand(question: string): { terms: string[]; intent: 'date' | 'amount' | 'party' | null; hindi: boolean } {
  const hindi = /[\u0900-\u097F]/.test(question);
  const terms: string[] = [];
  let intent: 'date' | 'amount' | 'party' | null = null;
  for (const t of tokens(question)) {
    if (HI[t]) {
      for (const h of HI[t]) {
        if (h === '@date') intent = 'date';
        else if (h === '@amount') intent = intent ?? 'amount';
        else if (h === '@party') intent = intent ?? 'party';
        else terms.push(h);
      }
      continue;
    }
    if (/[\u0900-\u097F]/.test(t)) continue; // unknown Hindi word
    terms.push(t, ...(SYN[t] ?? []));
  }
  const q = question.toLowerCase();
  if (/\bwhen\b|\bdate\b|\bdeadline\b|\bdue\b|\bby when\b/.test(q)) intent = 'date';
  else if (/\bhow much\b|\bamount\b|\btotal\b|\bcost\b|\bprice\b|\bvalue\b/.test(q)) intent = 'amount';
  else if (/\bwho\b|\bwhich (?:party|company)\b/.test(q)) intent = 'party';
  return { terms: [...new Set(terms)], intent, hindi };
}

export function answerLocally(question: string, pages: ParsedPage[], lang: Lang = 'en'): QAResult {
  const { terms, intent, hindi } = expand(question);
  const outLang: Lang = hindi || lang === 'hi' ? 'hi' : 'en';
  const lines = pages.flatMap((p) => p.lines).filter((l) => l.text.trim());
  if (!terms.length || !lines.length) return { answer: NOT_FOUND[outLang], citations: [], found: false };

  // Inverse document frequency over lines: rare words count more.
  const lineTokens = lines.map((l) => new Set(tokens(l.text)));
  const df = new Map<string, number>();
  for (const set of lineTokens) for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(1 + lines.length / (df.get(t) ?? 0.5));

  const scored = lines.map((l, i) => {
    let score = 0;
    let hits = 0;
    for (const t of terms) {
      if (lineTokens[i].has(t)) {
        score += idf(t);
        hits += 1;
      }
    }
    if (hits && intent === 'date' && findDates(l.text).length) score += 1.5;
    if (hits && intent === 'amount' && findCurrencyAmounts(l.text).length) score += 1.5;
    return { l, score, hits };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  // Needs at least one meaningful keyword hit; otherwise refuse instead of guessing.
  if (!best || best.hits === 0 || best.score < 1.6) return { answer: NOT_FOUND[outLang], citations: [], found: false };

  const picks = [best, ...scored.slice(1, 3).filter((s) => s.hits && s.score >= best.score * 0.8)].slice(0, 2);
  const citations: Citation[] = picks.map(({ l }) => ({ page: l.page, line: l.line, bbox: spanBox(l, 0, l.text.length), source_text: l.text.trim() }));
  const quote = best.l.text.trim();
  const where = `p.${best.l.page} · L${best.l.line}`;
  let answer: string;

  const date = findDates(quote)[0];
  const amount = findCurrencyAmounts(quote).slice(-1)[0];
  if (intent === 'date' && date) {
    answer = outLang === 'hi' ? `दस्तावेज़ के अनुसार तारीख ${formatDate(date.date)} है (${where}): “${quote}”` : `${formatDate(date.date)}. The document says (${where}): “${quote}”`;
  } else if (intent === 'amount' && amount) {
    answer = outLang === 'hi' ? `दस्तावेज़ में राशि ${formatINR(amount.value)} लिखी है (${where}): “${quote}”` : `${formatINR(amount.value)}. The document says (${where}): “${quote}”`;
  } else {
    answer = outLang === 'hi' ? `दस्तावेज़ में यह लिखा है (${where}): “${quote}”` : `Here is what the document says (${where}): “${quote}”`;
  }
  if (picks[1]) {
    const l2 = picks[1].l;
    answer += outLang === 'hi' ? `\nसाथ ही (p.${l2.page} · L${l2.line}): “${l2.text.trim()}”` : `\nAlso relevant (p.${l2.page} · L${l2.line}): “${l2.text.trim()}”`;
  }
  return { answer, citations, found: true };
}
