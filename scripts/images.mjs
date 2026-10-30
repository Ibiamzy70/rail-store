// scripts/images.mjs — generates AVIF + WebP variants from /raw into /public/img
// Usage:  npm run images            (skips images that are already up to date)
//         npm run images -- --force (regenerate everything)
import sharp from 'sharp';
import { readdir, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

 const WIDTHS = [480, 960];// must match store.imageWidths in clothes.json
const RAW = 'raw';
const OUT = 'public/img';
const FORCE = process.argv.includes('--force');

const mtime = async (p) => {
  try {
    return (await stat(p)).mtimeMs;
  } catch {
    return 0;
  }
};

await mkdir(OUT, { recursive: true });

let files;
try {
  files = (await readdir(RAW)).filter((f) => /\.(png|tiff?|webp)$/i.test(f)).sort();
} catch {
  console.error(`Cannot read the "${RAW}" folder. Run this from the project root.`);
  process.exit(1);
}
if (!files.length) {
  console.error(`No PNG/TIFF/WebP files found in "${RAW}/".`);
  process.exit(1);
}

let warnings = 0;
const report = [];

for (const file of files) {
  const name = path.parse(file).name;
  const input = path.join(RAW, file);
  const srcTime = await mtime(input);
  const { width, height, hasAlpha } = await sharp(input).metadata();

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    console.warn(`! ${name}: use lowercase kebab-case filenames (letters, numbers, hyphens)`);
    warnings++;
  }
  if (!/-(front|back|side)$/.test(name)) {
    console.warn(`! ${name}: expected a -front, -back or -side suffix`);
    warnings++;
  }
  if (!hasAlpha) {
    console.warn(`! ${name}: no transparency found. The rail needs transparent cut-outs.`);
    warnings++;
  }
  if (width < WIDTHS.at(-1)) {
    console.warn(`! ${name}: source is ${width}px wide, so the 2400 variant will be missing`);
    warnings++;
  }
  const ratio = width / height;
  if (Math.abs(ratio - 4 / 5) / (4 / 5) > 0.03) {
    console.warn(`! ${name}: ${width}x${height} is not 4:5 (ratio ${ratio.toFixed(3)})`);
    warnings++;
  }

  let made = 0;
  for (const w of WIDTHS) {
    if (w > width) continue;
    const avifPath = path.join(OUT, `${name}-${w}.avif`);
    const webpPath = path.join(OUT, `${name}-${w}.webp`);
    const upToDate =
      !FORCE && (await mtime(avifPath)) > srcTime && (await mtime(webpPath)) > srcTime;
    if (upToDate) continue;

    const resized = sharp(input).resize({ width: w, withoutEnlargement: true }).toColourspace('srgb');
    await resized.clone().avif({ quality: 58, effort: 4 }).toFile(avifPath);
    await resized.clone().webp({ quality: 82, alphaQuality: 90, effort: 5 }).toFile(webpPath);
    made++;
  }
  report.push({ name, width, height, made });
  console.log(
    `${name}: ${width}x${height} ${made ? `(${made} sizes generated)` : '(up to date)'}`,
  );
}

// Group results by garment so front/back land together
const groups = {};
for (const r of report) {
  const m = r.name.match(/^(.*)-(front|back|side)$/);
  const slug = m ? m[1] : r.name;
  const side = m ? m[2] : 'front';
  (groups[slug] ??= {})[side] = {
    base: `/img/${r.name}`,
    width: r.width,
    height: r.height,
  };
}

for (const [slug, sides] of Object.entries(groups)) {
  if (!sides.front) {
    console.warn(`! ${slug}: has no -front image`);
    warnings++;
  }
  if (!sides.back) {
    console.warn(`! ${slug}: has no -back image`);
    warnings++;
  }
}

console.log('\nPaste into clothes.json (one "images" block per garment):');
for (const [slug, sides] of Object.entries(groups)) {
  console.log(`\n// ${slug}`);
  console.log(JSON.stringify({ images: sides }, null, 2));
}
console.log(warnings ? `\nDone with ${warnings} warning(s). Fix them before continuing.` : '\nDone. No warnings.');