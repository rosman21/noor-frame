// Records animation.html into Android's bootanimation.zip format:
//   build/bootanimation.zip  →  desc.txt, part0/ (the intro, once), part1/ (the loop)
// Frames are JPEGs at the frame's resolution: smooth light and gradients are about a tenth of the
// size of PNGs, which keeps decoding quick on a slow frame (Android 6's boot animation reads both).
// The zip is stored without compression, as Android requires. Needs Playwright's Chromium
// (npx playwright install chromium) and the internet once, for the Amiri and Archivo fonts.
//
//   node apps/kiosk-android/bootanimation/render.mjs [--preview]   (--preview: a few stills only)
//   node apps/kiosk-android/bootanimation/render.mjs --still apps/kiosk-pi/splash/noor.png

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'build', 'bootanimation');
const ZIP = path.join(HERE, '..', 'build', 'bootanimation.zip');
const preview = process.argv.includes('--preview');
// --still <file.png>: one finished frame as a PNG (the Raspberry Pi boot splash).
const still = process.argv.includes('--still') ? process.argv[process.argv.indexOf('--still') + 1] : null;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(HERE, 'animation.html')).href + '?record');
await page.waitForFunction(() => window.fontsReady === true);
const { W, H, FPS, INTRO, LOOP } = await page.evaluate(() => window.ANIMATION);
const canvas = page.locator('#c');

async function frame(t, file) {
  await page.evaluate((x) => window.render(x), t);
  await canvas.screenshot({ path: file, type: 'jpeg', quality: 88 });
}

if (still) {
  await page.evaluate((x) => window.render(x), INTRO);
  await canvas.screenshot({ path: still, type: 'png' });
  console.log(`Wrote ${still}`);
} else if (preview) {
  for (const t of [0.3, 0.9, 1.5, 2.0, 2.6, INTRO, INTRO + LOOP * 0.45]) await frame(t, path.join(OUT, `preview-${t.toFixed(2)}.jpg`));
  console.log(`Preview stills in ${OUT}`);
} else {
  const parts = [['part0', 0, Math.round(INTRO * FPS)], ['part1', INTRO, Math.round(LOOP * FPS)]];
  for (const [name, start, count] of parts) {
    fs.mkdirSync(path.join(OUT, name));
    for (let i = 0; i < count; i++) await frame(start + i / FPS, path.join(OUT, name, String(i + 1).padStart(3, '0') + '.jpg'));
  }
  // Intro once, then loop until Android has started (the same layout as the stock file).
  fs.writeFileSync(path.join(OUT, 'desc.txt'), `${W} ${H} ${FPS}\np 1 0 part0\np 0 0 part1\n`);
  fs.rmSync(ZIP, { force: true });
  execFileSync('zip', ['-0', '-q', '-r', '-X', ZIP, 'desc.txt', 'part0', 'part1'], { cwd: OUT });
  const mb = (fs.statSync(ZIP).size / 1e6).toFixed(1);
  console.log(`Built ${path.relative(process.cwd(), ZIP)} (${mb} MB, ${parts.reduce((s, p) => s + p[2], 0)} frames)`);
}
await browser.close();
