// "Rupees Four Lakh Eighty Two Thousand Five Hundred Only" -> 482500
// Understands Indian (lakh, crore) and Western (million, billion) scales and
// an optional "and Fifty Paise" / "and 50/100" fraction.

const SMALL = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const SCALE = {
  thousand: 1e3,
  lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5,
  million: 1e6, millions: 1e6,
  crore: 1e7, crores: 1e7,
  billion: 1e9, billions: 1e9,
};

const FILLER = new Set(['and', 'only', 'rupees', 'rupee', 'rs', 'inr', 'dollars', 'dollar', 'usd', 'euros', 'euro', 'amount', 'in', 'words', 'of', 'the', 'total', 'a', 'sum', 'chargeable', 'payable', 'indian', 'us']);

function wordsToInteger(tokens) {
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
    } else if (FILLER.has(t)) {
      continue;
    } else {
      return null; // an unknown word: refuse to guess
    }
  }
  return seen ? total + current : null;
}

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[-–]/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Parse an amount written in words. Returns null when the phrase contains no
 * number words or anything we do not understand.
 */
export function parseAmountInWords(text) {
  if (!text) return null;
  const lower = String(text).toLowerCase();

  // Split off the fractional part: "... and fifty paise" / "... and cents twenty"
  let main = lower;
  let fraction = 0;
  const paise = lower.match(/\band\s+([a-z\s-]+?)\s+(paise|paisa|cents?)\b/);
  if (paise) {
    const f = wordsToInteger(tokenize(paise[1]));
    if (f != null && f < 100) {
      fraction = f / 100;
      main = lower.slice(0, paise.index);
    }
  } else {
    const slash = lower.match(/\band\s+(\d{1,2})\s*\/\s*100\b/);
    if (slash) {
      fraction = Number(slash[1]) / 100;
      main = lower.slice(0, slash.index);
    }
  }

  const tokens = tokenize(main);
  if (!tokens.some((t) => t in SMALL || t in SCALE || t === 'hundred')) return null;
  const whole = wordsToInteger(tokens);
  if (whole == null) return null;
  return Math.round((whole + fraction) * 100) / 100;
}

/** Pull the words part out of a line like "Amount in words: Rupees ... Only". */
export function extractWordsPhrase(line) {
  const m = String(line).match(/(?:in\s+words\s*[:-]?\s*)?((?:(?:rupees|rs\.?|inr|us\s+dollars|dollars)\s+)?[a-z][a-z\s,-]*?\s(?:only|paise|paisa|cents?)\b)/i);
  if (m) return m[1];
  const after = String(line).split(/in\s+words\s*[:-]/i)[1];
  return after ? after.trim() : null;
}

const NUM_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
  thirty: 30, forty: 40, 'forty-five': 45, fortyfive: 45, sixty: 60,
  ninety: 90, hundred: 100,
};

/** "thirty (30)" -> 30, "sixty" -> 60, "45" -> 45 */
export function smallNumber(word) {
  if (word == null) return null;
  const w = String(word).toLowerCase().trim();
  if (/^\d+$/.test(w)) return Number(w);
  if (w in NUM_WORDS) return NUM_WORDS[w];
  const parsed = wordsToInteger(tokenize(w));
  return parsed;
}
