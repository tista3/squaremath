// Real-browser smoke test of the child journey (desktop + phone). Needs a built app being served:
//   npm run build && npx vite preview --port 4320 --strictPort
//   npx -y -p playwright-core node e2e/smoke.mjs
// Env: CHROME_PATH (browser executable), BASE_URL (default http://localhost:4320/), OUT_DIR (default e2e/out).
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL ?? 'http://localhost:4320/';
const OUT = resolve(process.env.OUT_DIR ?? join(here, 'out'));
const TEMPLATE = process.env.TEMPLATE ?? 'Little star';
mkdirSync(OUT, { recursive: true });

/** playwright-core from PLAYWRIGHT_CORE, a local install, or `npx -p playwright-core` (its node_modules/.bin is on PATH). */
function loadPlaywright() {
  if (process.env.PLAYWRIGHT_CORE) return createRequire(import.meta.url)(resolve(process.env.PLAYWRIGHT_CORE));
  const bases = [process.cwd(), here];
  for (const dir of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    if (/node_modules[\\/]\.bin$/.test(dir)) bases.push(join(dir, '..', '..'));
  }
  for (const base of bases) {
    try {
      return createRequire(join(base, 'noop.js'))('playwright-core');
    } catch {}
  }
  throw new Error('playwright-core not found: run with `npx -y -p playwright-core node e2e/smoke.mjs`');
}

function chromePath() {
  const known = {
    win32: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  };
  const path = process.env.CHROME_PATH ?? (known[process.platform] ?? []).find((p) => existsSync(p));
  if (!path) throw new Error('No Chrome found: set CHROME_PATH');
  return path;
}

const VIEWPORTS = {
  desktop: { viewport: { width: 1366, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
};

const errors = [];
const step = (label, msg) => console.log(`[${label}] ${msg}`);
function check(cond, msg) {
  if (!cond) throw new Error(`Check failed: ${msg}`);
}

async function newPage(browser, label, opts) {
  const context = await browser.newContext({ ...opts, acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label}: console: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${label}: pageerror: ${e.message}`));
  return { context, page };
}

const shot = (page, label, name) => page.screenshot({ path: join(OUT, `${label}-${name}.png`) });
const storedDesigns = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('squaremath.designs.v2') ?? '{"designs":[]}').designs);

/** Solves the board with the keyboard: digits pick the legend slot, Space paints, arrows walk a serpentine. */
async function solveWithKeyboard(page, design) {
  const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const slotByHex = await page.$$eval('.solve-legend-colors .solve-legend-btn .swatch', (els) =>
    els.map((el) => {
      const [r, g, b] = getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number);
      return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    }),
  );
  check(slotByHex.length <= 9, 'at most 9 legend colours for keyboard solving');
  const hexAt = (i) => design.palette[ALPHABET.indexOf(design.cells[i])].hex.toLowerCase();
  await page.focus('.solve-scroller');
  await page.keyboard.press('Home');
  await page.keyboard.press('PageUp');
  let slot = -1;
  for (let r = 0; r < design.height; r++) {
    for (let k = 0; k < design.width; k++) {
      const c = r % 2 === 0 ? k : design.width - 1 - k;
      const want = slotByHex.indexOf(hexAt(r * design.width + c)) + 1;
      check(want > 0, `legend has the colour of cell ${r},${c}`);
      if (want !== slot) await page.keyboard.press(String((slot = want)));
      await page.keyboard.press('Space');
      if (k < design.width - 1) await page.keyboard.press(r % 2 === 0 ? 'ArrowRight' : 'ArrowLeft');
    }
    if (r < design.height - 1) await page.keyboard.press('ArrowDown');
  }
}

async function journey(browser, label, opts) {
  const { context, page } = await newPage(browser, label, opts);
  await page.goto(BASE);
  await page.waitForSelector('.template-card');
  await shot(page, label, '1-gallery');

  step(label, `template "${TEMPLATE}" → Use`);
  await page.locator('.template-card', { hasText: TEMPLATE }).locator('.btn.primary').click();
  await page.waitForURL(/#\/d\/[^/]+\/edit/);
  const canvas = page.locator('canvas.ed-canvas');
  await canvas.waitFor();
  const box = await canvas.boundingBox();
  for (const [y0, y1] of [[0.15, 0.15], [0.85, 0.5]]) {
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * y0);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * y1, { steps: 12 });
    await page.mouse.up();
  }
  await page.waitForTimeout(600); // debounced save
  await shot(page, label, '2-editor');

  step(label, 'puzzle page: × ÷ only');
  await page.locator('nav.design-nav a[href$="/puzzle"]').click();
  await page.waitForSelector('.puzzle-settings');
  for (const [name, on] of [['Multiplication', true], ['Division', true], ['Addition', false], ['Subtraction', false]]) {
    const btn = page.locator(`.puzzle-ops [aria-label="${name}"]`);
    if ((await btn.getAttribute('aria-pressed')) !== String(on)) await btn.click();
    check((await btn.getAttribute('aria-pressed')) === String(on), `${name} ${on ? 'on' : 'off'}`);
  }
  await page.waitForSelector('.puzzle-sheet');
  await shot(page, label, '3-puzzle');

  step(label, 'download PDF');
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /^PDF$/ }).click()]);
  const pdfPath = join(OUT, `${label}-${pdf.suggestedFilename()}`);
  await pdf.saveAs(pdfPath);
  check(readFileSync(pdfPath).subarray(0, 5).toString() === '%PDF-', 'PDF file');

  step(label, 'solve on screen');
  await page.locator('nav.design-nav a[href$="/solve"]').click();
  await page.waitForSelector('.solve-scroller');
  const id = page.url().match(/#\/d\/([^/]+)\//)[1];
  const design = (await storedDesigns(page)).find((d) => d.id === id);
  check(design, 'design saved in localStorage');
  await solveWithKeyboard(page, design);
  await page.waitForSelector('#solve-celebrate-title', { timeout: 5000 });
  await page.waitForTimeout(800); // entrance animation
  await shot(page, label, '4-celebration');

  step(label, 'share from the celebration');
  await page.locator('.solve-celebrate-actions .btn', { hasText: 'Share' }).click();
  const link = await page.locator('input[aria-label="Share link"]').inputValue();
  check(link.includes('#/s/'), 'share link');
  await page.keyboard.press('Escape');

  step(label, 'open the link in a fresh browser and save a copy');
  const friend = await newPage(browser, `${label}-friend`, opts);
  await friend.page.goto(link);
  await friend.page.getByRole('button', { name: /Save to my designs/ }).first().click();
  await friend.page.waitForURL(/#\/d\//);
  await friend.page.waitForTimeout(800); // debounced save
  check((await storedDesigns(friend.page)).length === 1, 'friend has one saved design');
  await shot(friend.page, label, '5-friend-copy');
  await friend.context.close();

  step(label, 'library export → wipe → import');
  await page.goto(BASE);
  await page.waitForSelector('.template-card');
  const before = (await storedDesigns(page)).length;
  const [json] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export library/ }).click()]);
  const jsonPath = join(OUT, `${label}-library.json`);
  await json.saveAs(jsonPath);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.template-card');
  check((await page.locator('.card:not(.template-card)').count()) === 0, 'library wiped');
  await page.locator('input[type=file]').setInputFiles(jsonPath);
  await page.waitForFunction((n) => document.querySelectorAll('.card:not(.template-card)').length === n, before);
  await page.waitForTimeout(600);
  check((await storedDesigns(page)).length === before, 'library restored');
  await shot(page, label, '6-imported');
  await context.close();
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: chromePath() });
let failed = false;
try {
  for (const [label, opts] of Object.entries(VIEWPORTS)) await journey(browser, label, opts);
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  await browser.close();
}
for (const e of errors) console.error(e);
console.log(failed || errors.length ? 'SMOKE FAILED' : `SMOKE OK (screenshots in ${OUT})`);
process.exit(failed || errors.length ? 1 : 0);
