/**
 * Browser assertions for the two surfaces this change owns.
 *
 * The page is the shipped web client served by the disposable launcher, so the
 * banner and the alert are the plugin own components in the real composition.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Find an installed Chromium. The Playwright pin and the downloaded browser
 * revision can drift, and the store keeps several; any working one serves.
 */
function findChromium() {
  if (process.env.MM_CHROMIUM) return process.env.MM_CHROMIUM;
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  let entries = [];
  try { entries = readdirSync(cache); } catch { return ''; }
  const shells = entries
    .filter((entry) => entry.startsWith('chromium_headless_shell-'))
    .sort()
    .reverse();
  for (const entry of shells) {
    const binary = join(cache, entry, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
    if (existsSync(binary)) return binary;
  }
  return '';
}

/** Resolve playwright inside a checkout, including a pnpm store layout. */
function resolvePlaywright(root) {
  const require = createRequire(join(root, 'package.json'));
  try { return require.resolve('playwright'); } catch { /* not a direct dependency */ }
  const store = join(root, 'node_modules', '.pnpm');
  let entries = [];
  try { entries = readdirSync(store); } catch { entries = []; }
  const candidates = entries
    .filter((entry) => entry.startsWith('playwright@'))
    .map((entry) => join(store, entry, 'node_modules', 'playwright'));
  for (const candidate of candidates.sort().reverse()) {
    try { return require.resolve(candidate); } catch { /* try the next version */ }
  }
  throw new Error(`playwright not found under ${root}`);
}

/** Load the real GUI and read the surfaces. */
export async function readSurfacesInBrowser({ originPath, tokenPath, screenshotDir, playwrightRoot, ownerSessionId }) {
  // Playwright is not a plugin dependency: locate it inside the harness checkout,
  // including a pnpm store where it is not a direct dependency of the root.
  assert.ok(playwrightRoot, 'the caller must name a checkout that provides playwright');
  const playwright = await import(resolvePlaywright(playwrightRoot));
  const executablePath = findChromium();
  const browser = await playwright.default.chromium.launch(executablePath ? { executablePath } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    const origin = readFileSync(originPath, 'utf8').trim();
    const token = readFileSync(tokenPath, 'utf8').trim();

    await page.goto(`${origin}/?token=${encodeURIComponent(token)}`);
    await page.waitForSelector('[data-shell-overlay]', { timeout: 90000 });

    // Point the app at a conversation that does NOT own the wait, so the alert is
    // the surface under test: the banner belongs to the owning conversation only.
    await page.evaluate(() => {
      localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-elsewhere' }));
    });
    await page.reload();
    await page.waitForSelector('[data-shell-overlay]', { timeout: 90000 });

    // Both surfaces poll every two seconds; allow a few cycles.
    await page.waitForSelector('.mm_alert', { timeout: 45000 });

    const surfaces = await page.evaluate(() => {
      const box = (element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          width: Math.round(rect.width),
          top: Math.round(rect.top),
          borderRadius: style.borderRadius,
          text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300),
          cards: element.querySelectorAll('.mm_alertCard').length,
          rows: element.querySelectorAll('.mm_authRow').length,
          buttons: [...element.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean),
        };
      };
      return {
        alert: box(document.querySelector('.mm_alert')),
        banner: box(document.querySelector('.mm_auth')),
        hasAuthorizationUrl: (document.body.textContent || '').includes('code_challenge='),
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    });

    assert.ok(surfaces.alert, 'the frame-wide alert rendered');
    assert.match(surfaces.alert.text, /blocked/, 'the alert names the server');
    assert.equal(surfaces.alert.cards, 1, 'one card per wait');
    assert.ok(surfaces.alert.buttons.length > 0, 'the alert offers actions');
    assert.equal(surfaces.hasAuthorizationUrl, false, 'no authorization URL is embedded');
    assert.ok(surfaces.alert.top >= 0 && surfaces.alert.top < surfaces.viewport.height, 'the alert is on screen');

    // Reload once more: whatever modal the application shows on this fresh profile
    // stays open, and the alert must remain visible above it.
    // (The previous comment described an earlier attempt; this is the real check.)
    // banner (not the alert) is the surface that reports the same wait.
    await page.evaluate((owner) => {
      localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: owner }));
    }, ownerSessionId);
    await page.reload();
    await page.waitForSelector('[data-shell-overlay]', { timeout: 90000 });
    await page.waitForTimeout(6000);

    const owned = await page.evaluate(() => {
      const banner = document.querySelector('.mm_auth');
      const alert = document.querySelector('.mm_alert');
      const box = (element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          width: Math.round(rect.width),
          top: Math.round(rect.top),
          borderRadius: style.borderRadius,
          text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240),
          rows: element.querySelectorAll('.mm_authRow').length,
          cards: element.querySelectorAll('.mm_alertCard').length,
        };
      };
      return { banner: box(banner), alert: box(alert), viewport: window.innerWidth };
    });

    if (screenshotDir) {
      mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({ path: join(screenshotDir, 'alert-in-real-gui.png') });
    }

    if (screenshotDir) {
      await page.screenshot({ path: join(screenshotDir, 'alert-over-modal.png') });
    }
    return { ...surfaces, owned };
  } finally {
    await browser.close();
  }
}
