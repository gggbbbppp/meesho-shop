// Parses the scraped site's window.PRODUCTS = [...] global into clean JSON.
// This is the authoritative product catalog — NOT scraped_site/products.json,
// which has a missing-price bug for ~half the records (see project notes).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../../scraped_site/assets/js/products.js');
const OUT = path.resolve(__dirname, '../data/products.json');

const raw = readFileSync(SRC, 'utf8');
const match = raw.match(/window\.PRODUCTS\s*=\s*(\[[\s\S]*\]);?\s*$/);
if (!match) {
  throw new Error('Could not find window.PRODUCTS array in products.js');
}

const products = JSON.parse(match[1]);
writeFileSync(OUT, JSON.stringify(products, null, 2), 'utf8');
console.log(`Extracted ${products.length} products -> ${OUT}`);
