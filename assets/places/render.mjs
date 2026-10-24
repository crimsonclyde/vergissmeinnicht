/**
 * Renders the Places artwork (section 30) once into the WebP files the app ships:
 *   node assets/places/render.mjs [country…] [--preview]
 * Each scene module returns a day picture and the positions of lit windows (a separate layer). The
 * wide set is the whole 2400×1600 scene; the portrait set is its centre (1000×1600), drawn at full
 * detail rather than cropped from the wide file. Uses the repository's Playwright Chromium and sharp.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lightsLayer } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const require = createRequire(join(root, 'packages', 'media', 'package.json'));
const sharp = require('sharp');
const { chromium } = createRequire(join(root, 'package.json'))('playwright');

const W = 2400;
const H = 1600;
const PORTRAIT = { x: 700, w: 1000 };
const SETS = {
  wide: { crop: { x: 0, w: W }, width: 1920 },
  wideSmall: { crop: { x: 0, w: W }, width: 1280 },
  portrait: { crop: PORTRAIT, width: 960 },
  portraitSmall: { crop: PORTRAIT, width: 600 },
};

const args = process.argv.slice(2);
const preview = args.includes('--preview');
const countries = args.filter((a) => !a.startsWith('--'));
const list = countries.length > 0 ? countries : ['de', 'it', 'uk', 'scotland'];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

/** Renders the whole scene at the crop's scale, then cuts the crop out (filters need the full canvas). */
async function rasterise(svgText, crop, width, transparent) {
  const scale = width / crop.w;
  const fullW = Math.round(W * scale);
  const height = Math.round(H * scale);
  await page.setViewportSize({ width: fullW, height });
  const view = svgText.replace(/width="\d+" height="\d+"/, `width="${fullW}" height="${height}"`);
  await page.setContent(`<html><body style="margin:0;background:${transparent ? 'transparent' : '#000'}">${view}</body></html>`);
  const png = await page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width: fullW, height } });
  if (crop.x === 0 && crop.w === W) return png;
  return sharp(png).extract({ left: Math.round(crop.x * scale), top: 0, width, height }).png().toBuffer();
}

for (const id of list) {
  const { scene } = await import(`./scene-${id}.mjs`);
  const { svg, lights, warm } = scene();
  const day = svg.toString();
  const glow = lightsLayer(W, H, lights, warm).toString();
  const out = join(root, 'apps', 'web', 'src', 'places', 'art', id);
  mkdirSync(out, { recursive: true });
  if (preview) {
    const png = await rasterise(day, { x: 0, w: W }, 1600, false);
    writeFileSync(join(here, `preview-${id}.png`), png);
    const night = await rasterise(glow, { x: 0, w: W }, 1600, true);
    const combined = await sharp(png).modulate({ brightness: 0.45 }).composite([{ input: night }]).png().toBuffer();
    writeFileSync(join(here, `preview-${id}-night.png`), combined);
    console.log(`${id}: preview written`);
    continue;
  }
  for (const [name, set] of Object.entries(SETS)) {
    const png = await rasterise(day, set.crop, set.width, false);
    const webp = await sharp(png).webp({ quality: name.endsWith('Small') ? 72 : 74, effort: 6 }).toBuffer();
    writeFileSync(join(out, `${name}.webp`), webp);
    const lightPng = await rasterise(glow, set.crop, set.width, true);
    const lightWebp = await sharp(lightPng).webp({ quality: 70, alphaQuality: 80, effort: 6 }).toBuffer();
    writeFileSync(join(out, `lights-${name}.webp`), lightWebp);
    console.log(`${id}/${name}: ${webp.byteLength} B, lights ${lightWebp.byteLength} B`);
  }
}
await browser.close();
