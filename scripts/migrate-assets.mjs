// Copies static assets (CSS, hero/banner images, and product photos) from the
// scraped snapshot into webapp/public, at the exact relative paths the
// original pages reference (so the untouched HTML keeps working).
//
// Product images are the tricky part: the scraper downloaded them into a
// single flat folder with sanitized filenames, losing the original
// "images/products/pXX/<name>" structure. We reconstruct that mapping by
// replaying the exact transform the scraper applied:
//   1. the browser resolves <img>.src to a fully percent-encoded absolute URL
//   2. the scraper takes the URL path's basename
//   3. the scraper replaces runs of non [a-zA-Z0-9._-] chars with a single "-"
//   4. truncates to 150 chars, trims leading/trailing "-"
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SCRAPED = path.join(ROOT, 'scraped_site');
const WEBAPP = path.resolve(__dirname, '..');
const PUBLIC = path.join(WEBAPP, 'public');

function safeFilename(value) {
  let out = value.replace(/[^a-zA-Z0-9._-]+/g, '-');
  out = out.slice(0, 150).replace(/^-+/, '').replace(/-+$/, '');
  return out || 'file';
}

function scrapedDownloadName(basename) {
  // Mirrors what the browser's `.src` property + scraper's safe_filename did.
  const percentEncoded = encodeURIComponent(basename)
    // encodeURIComponent escapes ! ' ( ) * too aggressively vs a real browser;
    // browsers leave these unescaped in resolved URLs, so undo that here.
    .replace(/%21/g, '!').replace(/%27/g, "'").replace(/%28/g, '(')
    .replace(/%29/g, ')').replace(/%2A/g, '*');
  return safeFilename(percentEncoded);
}

function copyInto(destRelPath, srcAbsPath) {
  const dest = path.join(PUBLIC, destRelPath);
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(srcAbsPath, dest);
}

// ---- 1. CSS ----
copyInto('assets/styles.css', path.join(SCRAPED, 'assets/css/styles-R9I6CBHq.css'));

// ---- 2. Hero / banner images (already have clean hashed filenames) ----
const bannerFiles = [
  'kurti1-CcoeKMaM.webp',
  'kurti2-BijmMluk.jpg',
  'kurti3-VJxgG-0W.jpg',
  'kurti4-BPcNrcZO.jpg',
  '1-Crt5p7WI.webp',
];
for (const f of bannerFiles) {
  const src = path.join(SCRAPED, 'assets/images', f);
  if (existsSync(src)) copyInto(`assets/${f}`, src);
}

// ---- 3. Product images ----
const products = JSON.parse(readFileSync(path.join(WEBAPP, 'data/products.json'), 'utf8'));
const downloadedFiles = new Set(readdirSync(path.join(SCRAPED, 'assets/images')));

const missing = [];
let copied = 0;
const seen = new Set();

for (const p of products) {
  const allPaths = [p.image, ...(p.images || [])].filter(Boolean);
  for (const relPath of allPaths) {
    if (seen.has(relPath)) continue;
    seen.add(relPath);

    const basename = path.basename(relPath);
    const downloadName = scrapedDownloadName(basename);

    if (!downloadedFiles.has(downloadName)) {
      missing.push({ product: p.id, relPath, downloadName });
      continue;
    }

    const src = path.join(SCRAPED, 'assets/images', downloadName);
    copyInto(relPath, src); // preserve e.g. images/products/p1/xxx.jpeg
    copied++;
  }
}

console.log(`Copied ${copied} product images.`);
if (missing.length) {
  console.log(`\n${missing.length} image(s) could not be matched:`);
  for (const m of missing.slice(0, 20)) {
    console.log(`  product ${m.product}: ${m.relPath} -> expected "${m.downloadName}"`);
  }
  if (missing.length > 20) console.log(`  ... and ${missing.length - 20} more`);
}
