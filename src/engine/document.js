// The document model every parser produces and every extractor reads.
//
// A document is a list of pages, each page a list of lines. Every line gets a
// stable id ("p2-L18") so a finding can point back to exactly where it came
// from. That id is the heart of "no source, no output".

let docCounter = 0;

export function lineId(page, line) {
  return `p${page}-L${line}`;
}

/**
 * @param {string} name   file name shown to the user
 * @param {string[][]} rawPages  array of pages, each an array of line strings
 * @param {object} [meta] extra info (source format, etc.)
 */
export function buildDocument(name, rawPages, meta = {}) {
  docCounter += 1;
  const pages = [];
  const lines = [];

  rawPages.forEach((rawLines, pageIndex) => {
    const pageNumber = pageIndex + 1;
    const trimmed = trimBlankEdges(rawLines.map((l) => String(l ?? '').replace(/\s+$/, '')));
    const pageLines = trimmed.map((text, i) => {
      const line = {
        id: lineId(pageNumber, i + 1),
        page: pageNumber,
        line: i + 1,
        text: text.replace(/\t/g, '    '),
      };
      lines.push(line);
      return line;
    });
    pages.push({ number: pageNumber, lines: pageLines });
  });

  const byId = new Map(lines.map((l) => [l.id, l]));

  return {
    id: `doc-${Date.now().toString(36)}-${docCounter}`,
    name: name || 'untitled',
    format: meta.format || 'text',
    pages,
    lines,
    byId,
    text: lines.map((l) => l.text).join('\n'),
  };
}

function trimBlankEdges(arr) {
  let start = 0;
  let end = arr.length;
  while (start < end && !arr[start].trim()) start += 1;
  while (end > start && !arr[end - 1].trim()) end -= 1;
  return arr.slice(start, end);
}

// Page markers we understand in plain text: a form-feed character, or a line
// such as "--- Page 2 ---" / "=== PAGE 2 of 14 ===".
const PAGE_MARKER = /^\s*[-=_*]{2,}\s*page\s+\d+(?:\s+of\s+\d+)?\s*[-=_*]{2,}\s*$/i;

export function textToPages(text) {
  const normalized = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');

  const pages = [[]];
  for (const raw of normalized.split('\n')) {
    const parts = raw.split('\f');
    parts.forEach((part, i) => {
      if (i > 0) pages.push([]);
      if (PAGE_MARKER.test(part)) {
        if (pages[pages.length - 1].some((l) => l.trim())) pages.push([]);
        return;
      }
      pages[pages.length - 1].push(part);
    });
  }
  const nonEmpty = pages.filter((p) => p.some((l) => l.trim()));
  return nonEmpty.length ? nonEmpty : [[]];
}

export function documentFromText(name, text, meta) {
  return buildDocument(name, textToPages(text), meta);
}

export function isEmptyDocument(doc) {
  return !doc.lines.some((l) => l.text.trim());
}
