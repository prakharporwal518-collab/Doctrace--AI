// Copies the Tesseract.js worker, WASM core and English + Hindi language data
// into public/tesseract so OCR runs from our own domain (no third-party CDN).
// Runs automatically before `npm run dev` and `npm run build`.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'tesseract');
const nm = join(root, 'node_modules');

const files = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  // LSTM-only builds (we always run OEM 1). Tesseract picks the best one for the device.
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz'],
  ['@tesseract.js-data/hin/4.0.0_best_int/hin.traineddata.gz', 'lang/hin.traineddata.gz'],
];

let copied = 0;
for (const [from, to] of files) {
  const src = join(nm, from);
  const dest = join(out, to);
  if (!existsSync(src)) {
    console.warn(`[ocr-assets] missing ${from}. Run npm install. OCR will not work until it is present.`);
    continue;
  }
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest) && statSync(dest).size === statSync(src).size) continue;
  copyFileSync(src, dest);
  copied += 1;
}
console.log(`[ocr-assets] ${copied ? `copied ${copied} file(s)` : 'up to date'} -> public/tesseract`);
