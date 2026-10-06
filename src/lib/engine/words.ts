// "Rupees Four Lakh Eighty Two Thousand Five Hundred Only" -> 482500.
// Understands lakh/crore, million/billion, and "and Fifty Paise".

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fourty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALE: Record<string, number> = {
  thousand: 1e3, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, million: 1e6,
  crore: 1e7, crores: 1e7, billion: 1e9,
};
const FILLER = new Set(['and', 'only', 'rupees', 'rupee', 'rs', 'inr', 'dollars', 'dollar', 'amount', 'in', 'words', 'of', 'the', 'total', 'a', 'sum', 'indian', 'us', 'payable', 'chargeable']);

function wordsToInteger(tokens: string[]): number | null {
  let total = 0;
  let current = 0;
  let seen = false;
  for (const t of tokens) {
    if (t in SMALL) {
      current += SMALL[t];
      seen = true;
    } else if (t === 'hundred') {
      current = (current || 1) * 100;
      seen = true;
    } else if (t in SCALE) {
      total += (current || 1) * SCALE[t];
      current = 0;
      seen = true;
    } else if (!FILLER.has(t)) {
      return null; // unknown word: refuse to guess
    }
  }
  return seen ? total + current : null;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[-–]/g, ' ').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
}

export function parseAmountInWords(text: string | null | undefined): number | null {
  if (!text) return null;
  const lower = String(text).toLowerCase();
  let main = lower;
  let fraction = 0;
  const paise = lower.match(/\band\s+([a-z\s-]+?)\s+(paise|paisa|cents?)\b/);
  if (paise && paise.index != null) {
    const f = wordsToInteger(tokenize(paise[1]));
    if (f != null && f < 100) {
      fraction = f / 100;
      main = lower.slice(0, paise.index);
    }
  }
  const toks = tokenize(main);
  if (!toks.some((t) => t in SMALL || t in SCALE || t === 'hundred')) return null;
  const whole = wordsToInteger(toks);
  return whole == null ? null : Math.round((whole + fraction) * 100) / 100;
}

/** Pull the words out of "Amount in words: Rupees ... Only". */
export function extractWordsPhrase(line: string): string | null {
  const m = line.match(/((?:(?:rupees|rs\.?|inr|us\s+dollars|dollars)\s+)?[a-z][a-z\s,-]*?\s(?:only|paise|paisa|cents?)\b)/i);
  if (m) {
    // Drop a leading "Amount in words:" label if the regex swallowed it.
    return m[1].replace(/^.*?in\s+words\s*:?\s*/i, '').trim();
  }
  const after = line.split(/in\s+words\s*[:-]/i)[1];
  return after ? after.trim() : null;
}

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45,
  sixty: 60, ninety: 90, hundred: 100,
};

/** "thirty" -> 30, "45" -> 45 */
export function smallNumber(word: string | null | undefined): number | null {
  if (word == null) return null;
  const w = word.toLowerCase().trim();
  if (/^\d+$/.test(w)) return Number(w);
  if (w in NUM_WORDS) return NUM_WORDS[w];
  return wordsToInteger(tokenize(w));
}
