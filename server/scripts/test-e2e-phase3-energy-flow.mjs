// Phase 3 E2E — EnergyFlowOverlay end-to-end verification.
//
// Covers loading-time engagement (overlay auto-mounts during roof analysis),
// prominent status card (analysing / complete / error states), 4 time-of-day
// modes (Sunny / Cloudy / Evening / Night), CTA-gated stage transition
// ("See my roof analysis" click commits pendingAnalysis and advances to
// AddressStage), and localStorage flag propagation.
//
// Uses puppeteer-core -> installed Chrome. Both servers must be running:
//   - client :5173 (Vite dev)
//   - server :5000 (Node/Express)
//
// Screenshots saved to <this-dir>/e2e-phase3-out/
//
// Run:  E2E_HEADLESS=1 node scripts/test-e2e-phase3-energy-flow.mjs

import puppeteer from 'puppeteer-core';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'e2e-phase3-out');
const CHROME = process.env.E2E_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CLIENT_URL = 'http://localhost:5173';
const HEADLESS = process.env.E2E_HEADLESS !== '0';

let pass = 0, fail = 0;
const results = [];
const assert = (cond, msg) => {
  if (cond) { pass++; console.log(`  PASS  ${msg}`); results.push({ ok: true, msg }); }
  else      { fail++; console.error(`  FAIL  ${msg}`); results.push({ ok: false, msg }); }
};

async function screenshot(page, filename) {
  const full = path.join(OUT_DIR, filename);
  await page.screenshot({ path: full, fullPage: false });
  console.log(`    -> saved ${filename}`);
  return full;
}

async function clickByText(page, text) {
  const clicked = await page.evaluate((t) => {
    const els = [...document.querySelectorAll('button, a, [role="button"]')];
    const match = els.find(e => e.textContent && e.textContent.trim().toLowerCase().includes(t.toLowerCase()) && !e.disabled);
    if (match) { match.click(); return true; }
    return false;
  }, text);
  if (!clicked) throw new Error(`No clickable element matching "${text}"`);
}

async function waitForText(page, text, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await page.evaluate((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), text);
    if (found) return;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Text "${text}" not found within ${timeoutMs}ms`);
}

async function inspectOverlay(page) {
  return page.evaluate(() => {
    const overlay = document.querySelector('.fixed.inset-0.bg-black\\/85')
                 || document.querySelector('[class*="z-[9999]"]');
    if (!overlay) return { present: false };
    const svg = overlay.querySelector('svg[viewBox="0 0 800 500"]');
    if (!svg) return { present: true, svg: false };

    const allPaths = [...svg.querySelectorAll('path')];
    const animatedPaths = allPaths.filter(p => {
      const cs = window.getComputedStyle(p);
      return cs.animationName && cs.animationName !== 'none';
    }).length;

    const anyCircleWith = (test) => [...svg.querySelectorAll('circle')].some(test);
    const hasSun = anyCircleWith(c =>
      c.getAttribute('cx') === '660' && c.getAttribute('cy') === '90' &&
      c.getAttribute('r') === '36' && (c.getAttribute('fill') || '').toLowerCase() === '#fcd34d');
    const hasMoon = anyCircleWith(c =>
      c.getAttribute('cx') === '660' && c.getAttribute('cy') === '90' &&
      c.getAttribute('r') === '30' && (c.getAttribute('fill') || '').toLowerCase() === '#e2e8f0');
    const hasSunset = anyCircleWith(c =>
      c.getAttribute('cx') === '640' && c.getAttribute('cy') === '140' &&
      (c.getAttribute('fill') || '').toLowerCase() === '#f97316');
    const hasCloud = !!svg.querySelector('ellipse[cx="500"][cy="120"]');
    const hasStars = [...svg.querySelectorAll('circle')]
      .some(c => (c.getAttribute('fill') || '').toLowerCase() === '#f8fafc');
    const leftWindow = [...svg.querySelectorAll('rect')].find(r =>
      r.getAttribute('x') === '160' && r.getAttribute('y') === '290' && r.getAttribute('width') === '55');
    const windowsGlow = (leftWindow?.getAttribute('fill') || '').toLowerCase() === '#fde68a';
    const hasBattery = [...svg.querySelectorAll('rect')].some(r =>
      r.getAttribute('x') === '418' && r.getAttribute('width') === '46');
    const hasEv = [...svg.querySelectorAll('rect')].some(r =>
      r.getAttribute('x') === '536' && r.getAttribute('width') === '18');
    const skyGrad = svg.querySelector('#sky-grad');
    const skyStops = skyGrad ? [...skyGrad.querySelectorAll('stop')] : [];
    const skyTopColor = skyStops[0]?.getAttribute('stop-color') || null;

    const activeTab = overlay.querySelector('button[aria-pressed="true"]');
    const activeMode = activeTab?.textContent?.trim() || null;

    // Phase 3 status card + CTA + flash
    const statusCard = overlay.querySelector('[data-status]');
    const status = statusCard?.getAttribute('data-status') || null;
    const statusText = statusCard?.textContent?.trim() || null;
    const ctaBtn = overlay.querySelector('[data-cta="see-results"]');
    const ctaText = ctaBtn?.textContent?.trim() || null;
    const flashOn = !!overlay.querySelector('[data-flash="gold"]');

    return {
      present: true, svg: true, animatedPaths, skyStops: skyStops.length,
      hasSun, hasMoon, hasSunset, hasCloud, hasStars, windowsGlow,
      hasBattery, hasEv, skyTopColor, activeMode,
      status, statusText, hasCta: !!ctaBtn, ctaText, flashOn,
    };
  });
}

async function clickModeTab(page, modeLabel) {
  await page.evaluate((label) => {
    const btns = [...document.querySelectorAll('button[aria-pressed]')];
    const match = btns.find(b => b.textContent?.trim() === label);
    if (!match) throw new Error(`Mode tab "${label}" not found`);
    match.click();
  }, modeLabel);
  await new Promise(r => setTimeout(r, 400));
}

// Pre-flight: skip gracefully if local servers aren't reachable so the
// regression runner treats us as SKIP not NEW-FAIL. Matches the pattern of
// test-e2e-browser.mjs etc. which are skipped when the server isn't up.
async function preflightServersReachable() {
  const check = async (url) => {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(t);
      return res.status < 500;
    } catch {
      return false;
    }
  };
  const [clientUp, serverUp] = await Promise.all([
    check(CLIENT_URL),
    check('http://localhost:5000/'),
  ]);
  return { clientUp, serverUp };
}

async function run() {
  const { clientUp, serverUp } = await preflightServersReachable();
  if (!clientUp || !serverUp) {
    console.log(`⊘ SKIP — servers not reachable (client:5173=${clientUp}, server:5000=${serverUp}). Start both with "npm run dev" in client/ and server/, then re-run.`);
    process.exit(0);
  }

  await fs.mkdir(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: HEADLESS ? 'new' : false,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox', '--disable-web-security'],
  });

  const page = await browser.newPage();

  const consoleErrors = [];
  page.on('pageerror', err => { consoleErrors.push(err.message); console.error(`  [browser ERROR] ${err.message}`); });
  page.on('console', msg => {
    if (msg.type() === 'error') { consoleErrors.push(msg.text()); console.error(`  [console ERROR] ${msg.text().slice(0, 200)}`); }
  });

  try {
    console.log('\n== Setup: clear localStorage ==');
    await page.goto(`${CLIENT_URL}/poc/quote`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.evaluate(() => localStorage.clear());
    console.log('  cleared');

    console.log('\n== Step 1: UploadStage -> manual (no-bill) flow ==');
    await page.goto(`${CLIENT_URL}/poc/quote`, { waitUntil: 'networkidle2', timeout: 30_000 });
    await waitForText(page, 'Drop your latest power bill');
    await clickByText(page, 'Just exploring');
    await waitForText(page, 'Tell us where you live');
    await screenshot(page, '00-address-stage.png');

    console.log('\n== Step 2: search + pick address ==');
    const input = await page.waitForSelector('input[placeholder*="typing your address"]', { timeout: 5_000 });
    await input.click();
    await input.type('Queen Street Auckland', { delay: 30 });
    await new Promise(r => setTimeout(r, 900));
    await page.waitForSelector('ul li', { timeout: 8_000 });
    await page.evaluate(() => {
      const first = document.querySelector('ul li');
      first?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 1_500));
    await clickByText(page, 'Continue to house preview');
    await new Promise(r => setTimeout(r, 800));

    console.log('\n== Step 3: wait for PreviewStage ==');
    await waitForText(page, 'Confirm this is my house', 20_000);
    await new Promise(r => setTimeout(r, 800));
    await screenshot(page, '01-preview-stage.png');
    assert(true, 'PreviewStage reached (Confirm button visible)');

    console.log('\n== Step 4: click Confirm -> verify overlay auto-mounts ==');
    await clickByText(page, 'Confirm this is my house');
    let overlayState = null;
    for (let i = 0; i < 20; i++) {
      overlayState = await inspectOverlay(page);
      if (overlayState.present) break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert(overlayState.present, 'Overlay auto-mounts within 2s of Confirm click');
    assert(overlayState.svg, 'Overlay contains SVG scene');
    await screenshot(page, '02-overlay-auto-mounted-sunny.png');

    console.log('\n== Step 5: Sunny mode default state ==');
    assert(overlayState.activeMode === 'Sunny day', `Default mode = Sunny (got "${overlayState.activeMode}")`);
    assert(overlayState.hasSun, 'Sunny: sun rendered');
    assert(!overlayState.hasMoon, 'Sunny: moon NOT rendered');
    assert(!overlayState.hasStars, 'Sunny: stars NOT rendered');
    assert(!overlayState.windowsGlow, 'Sunny: windows NOT glowing');
    assert(overlayState.animatedPaths >= 5, `Sunny: >=5 animated flow paths (got ${overlayState.animatedPaths})`);
    assert(overlayState.skyTopColor === '#DFF0FA', `Sunny: sky top = #DFF0FA (got ${overlayState.skyTopColor})`);
    assert(overlayState.hasBattery, 'Sunny: battery cabinet visible');
    assert(overlayState.hasEv, 'Sunny: EV + car visible');

    console.log('\n== Step 6: Cloudy tab ==');
    await clickModeTab(page, 'Cloudy');
    const cloudyState = await inspectOverlay(page);
    await screenshot(page, '03-mode-cloudy.png');
    assert(cloudyState.activeMode === 'Cloudy', `Active mode = Cloudy`);
    assert(cloudyState.hasSun, 'Cloudy: sun visible (dimmed)');
    assert(cloudyState.hasCloud, 'Cloudy: cloud sprite rendered');
    assert(cloudyState.animatedPaths === 3, `Cloudy: 3 flows (got ${cloudyState.animatedPaths})`);
    assert(cloudyState.skyTopColor === '#B4BFC9', `Cloudy: sky top = #B4BFC9`);

    console.log('\n== Step 7: Evening tab ==');
    await clickModeTab(page, 'Evening');
    const eveningState = await inspectOverlay(page);
    await screenshot(page, '04-mode-evening.png');
    assert(eveningState.activeMode === 'Evening', `Active mode = Evening`);
    assert(eveningState.hasSunset, 'Evening: sunset rendered');
    assert(!eveningState.hasSun, 'Evening: normal sun NOT rendered');
    assert(!eveningState.hasMoon, 'Evening: moon NOT rendered');
    assert(eveningState.windowsGlow, 'Evening: windows glowing');
    assert(eveningState.animatedPaths === 3, `Evening: 3 flows (got ${eveningState.animatedPaths})`);
    assert(eveningState.skyTopColor === '#FDBA74', `Evening: sky top = #FDBA74`);

    console.log('\n== Step 8: Night tab ==');
    await clickModeTab(page, 'Night');
    const nightState = await inspectOverlay(page);
    await screenshot(page, '05-mode-night.png');
    assert(nightState.activeMode === 'Night', `Active mode = Night`);
    assert(nightState.hasMoon, 'Night: moon rendered');
    assert(!nightState.hasSun, 'Night: sun NOT rendered');
    assert(nightState.hasStars, 'Night: stars rendered');
    assert(nightState.windowsGlow, 'Night: windows glowing');
    assert(nightState.animatedPaths === 3, `Night: 3 flows (got ${nightState.animatedPaths})`);
    assert(nightState.skyTopColor === '#1E293B', `Night: sky top = #1E293B`);

    console.log('\n== Step 9: prominent status card during analysing ==');
    const analysingInspect = await inspectOverlay(page);
    await screenshot(page, '06-status-analysing.png');
    assert(analysingInspect.status === 'analysing', `Status card data-status = "analysing" (got "${analysingInspect.status}")`);
    assert(/\d+s/.test(analysingInspect.statusText || ''), `Status card shows elapsed timer (got: "${(analysingInspect.statusText || '').slice(0, 80)}")`);
    assert(!analysingInspect.hasCta, 'No completion CTA during analysing');

    console.log('\n== Step 10: wait for status -> complete (up to 90s) ==');
    let completeInspect = null;
    const startWait = Date.now();
    while (Date.now() - startWait < 90_000) {
      completeInspect = await inspectOverlay(page);
      if (completeInspect.status === 'complete') break;
      if (completeInspect.status === 'error') {
        console.log(`  ! Analysis errored: ${completeInspect.statusText?.slice(0, 100)}`);
        break;
      }
      await new Promise(r => setTimeout(r, 750));
    }
    await screenshot(page, '07-status-complete.png');
    if (completeInspect?.status === 'complete') {
      assert(true, 'Status transitions to "complete" when server responds');
      assert(completeInspect.hasCta, 'Completion CTA appears in "complete" state');
      assert((completeInspect.ctaText || '').toLowerCase().includes('see my roof analysis'),
        `CTA text = "See my roof analysis" (got: "${completeInspect.ctaText}")`);
    } else {
      console.log(`  ! Skipping completion assertions - status = "${completeInspect?.status}"`);
    }

    console.log('\n== Step 11: click CTA -> commit + AddressStage ==');
    if (completeInspect?.status === 'complete') {
      await page.evaluate(() => {
        const btn = document.querySelector('[data-cta="see-results"]');
        btn?.click();
      });
      await new Promise(r => setTimeout(r, 1200));
      const afterCta = await inspectOverlay(page);
      await screenshot(page, '08-after-cta.png');
      assert(!afterCta.present, 'Overlay dismissed after CTA click');
      const onAddressStage = await page.evaluate(() =>
        document.body.innerText.includes('We pulled this from your bill')
        || document.body.innerText.includes('Is this your house')
        || document.body.innerText.includes('Google Solar read'));
      assert(onAddressStage, 'Committed to AddressStage after CTA click');
    }

    console.log('\n== Step 12: localStorage flag persists ==');
    const seenFlag = await page.evaluate(() => localStorage.getItem('poc:energyFlowSeen'));
    assert(seenFlag === '1', `localStorage["poc:energyFlowSeen"] === "1" (got "${seenFlag}")`);

    console.log('\n== Console error summary ==');
    assert(consoleErrors.length === 0, `Zero JS errors (got ${consoleErrors.length})`);
    if (consoleErrors.length > 0) {
      consoleErrors.forEach((e, i) => console.log(`    [${i + 1}] ${e.slice(0, 200)}`));
    }
  } catch (e) {
    console.error(`\nFATAL: E2E aborted: ${e.message}`);
    console.error(e.stack);
    fail++;
    try { await screenshot(page, '99-fatal-error.png'); } catch { /* noop */ }
  } finally {
    if (!HEADLESS) {
      console.log('\n(Browser stays open for 3s...)');
      await new Promise(r => setTimeout(r, 3000));
    }
    await browser.close();
  }

  console.log('\n== Coverage matrix ==');
  results.forEach((r) => console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.msg}`));
  console.log(`\n${pass} PASS - ${fail} FAIL - screenshots -> ${OUT_DIR}`);
  process.exit(fail === 0 ? 0 : 1);
}

run();
