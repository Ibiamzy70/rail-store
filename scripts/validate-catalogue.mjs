// scripts/validate-catalogue.mjs — checks public/data/clothes.json before you run the site
// Usage: npm run validate
import sharp from 'sharp';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';

const JSON_PATH = 'public/data/clothes.json';
const PUBLIC = 'public';
const RAW = 'raw';
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

let errors = 0;
let warns = 0;
const err = (m) => (console.error(`  ERROR  ${m}`), errors++);
const warn = (m) => (console.warn(`  warn   ${m}`), warns++);
const exists = (p) => access(p).then(() => true, () => false);

let data;
try {
  data = JSON.parse(await readFile(JSON_PATH, 'utf8'));
} catch (e) {
  console.error(`Cannot read or parse ${JSON_PATH}: ${e.message}`);
  process.exit(1);
}

const store = data.store ?? {};
const items = Array.isArray(data.items) ? data.items : [];
const WIDTHS = store.imageWidths ?? [480, 960, 1600, 2400];

if (!store.name) err('store.name is required');
if (!items.length) err('items is empty');
if (items.length > 60) warn(`${items.length} items: only the first 60 will render`);
if (store.logo && !(await exists(path.join(PUBLIC, store.logo)))) {
  warn(`store.logo "${store.logo}" does not exist yet`);
}

const seen = new Set();
const ratios = [];

for (const [i, it] of items.entries()) {
  const label = `items[${i}] ${it?.id ?? '(no id)'}`;
  console.log(label);

  if (!it.id || !KEBAB.test(it.id)) err(`${label}: id must be unique kebab-case`);
  if (seen.has(it.id)) err(`${label}: duplicate id`);
  seen.add(it.id);
  if (!it.name) err(`${label}: name is required`);

  if (it.price) {
    if (typeof it.price.amount !== 'number' || it.price.amount < 0) err(`${label}: price.amount must be a number`);
    try {
      new Intl.NumberFormat(store.locale ?? 'en-NG', { style: 'currency', currency: it.price.currency });
    } catch {
      err(`${label}: invalid currency code "${it.price.currency}"`);
    }
  }

  if (!it.cta?.href) err(`${label}: cta.href is required`);
  else {
    const m = it.cta.href.match(/^https:\/\/wa\.me\/(\d+)/);
    if (m && !/^234\d{10}$/.test(m[1])) {
      warn(`${label}: WhatsApp number ${m[1]} has ${m[1].length} digits. A Nigerian number should be 234 + 10 digits (13 total).`);
    }
    if (!/^https?:\/\//.test(it.cta.href)) err(`${label}: cta.href must be an http(s) URL`);
  }

  if (!it.images?.front) {
    err(`${label}: images.front is required`);
    continue;
  }

  for (const [view, img] of Object.entries(it.images)) {
    const tag = `${label} images.${view}`;
    if (!img.alt) err(`${tag}: alt text is required`);
    else if (/todo/i.test(img.alt)) warn(`${tag}: alt text is still a TODO placeholder`);
    if (!img.base) {
      err(`${tag}: base is required`);
      continue;
    }

    const rawFile = path.join(RAW, `${path.basename(img.base)}.png`);
    let srcWidth = img.width;
    if (await exists(rawFile)) {
      const meta = await sharp(rawFile).metadata();
      srcWidth = meta.width;
      if (meta.width !== img.width || meta.height !== img.height) {
        err(`${tag}: JSON says ${img.width}x${img.height} but ${rawFile} is ${meta.width}x${meta.height}`);
      }
    } else {
      warn(`${tag}: original ${rawFile} not found, so dimensions were not cross-checked`);
    }

    for (const w of WIDTHS) {
      if (w > srcWidth) continue;
      for (const ext of ['avif', 'webp']) {
        const f = path.join(PUBLIC, `${img.base}-${w}.${ext}`);
        if (!(await exists(f))) err(`${tag}: missing ${f}. Run npm run images.`);
      }
    }
    if (view === 'front') ratios.push({ id: it.id, r: img.width / img.height });
  }

  const a = it.anchor;
  if (a && (a.x < 0 || a.x > 1 || a.y < 0 || a.y > 1)) err(`${label}: anchor x/y must be between 0 and 1`);
}

if (ratios.length > 1) {
  const base = ratios[0].r;
  for (const { id, r } of ratios) {
    if (Math.abs(r - base) / base > 0.03) warn(`${id}: front image aspect ratio differs from the first item by more than 3%`);
  }
}

console.log(`\n${items.length} item(s) checked: ${errors} error(s), ${warns} warning(s).`);
process.exit(errors ? 1 : 0);
