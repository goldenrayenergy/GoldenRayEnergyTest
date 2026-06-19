// ────────────────────────────────────────────────────────────────────────────
// Headless browser launcher — shared by every PDF rendering code path.
//
// Phase G1 — swapped the heavy `puppeteer` package (which bundles ~300 MB of
// Chromium and needs system libs that Render's free image doesn't ship) for
// `puppeteer-core` + `@sparticuz/chromium-min`. The latter is a tiny npm
// stub that downloads a single static Chromium tarball at runtime on first
// launch; once cached in /tmp it boots in <1s.
//
//   • Production (Render): ~50 MB install footprint, fits in 512 MB worker
//   • Local dev (Windows / macOS): falls back to system Chrome / Edge via
//     PUPPETEER_EXECUTABLE_PATH env var. Set this in your local .env if you
//     want real PDF rendering during development — otherwise renderPdf.js
//     gracefully falls back to an HTML buffer (and the caller surfaces a
//     `used_fallback: true` flag so it's visible, not silent).
//
// Anti-regression: the silent-fallback bug that produced HTML-as-PDF artifacts
// is killed at the source — launchHeadlessBrowser() throws cleanly on failure
// and lets renderPdf.js decide how loudly to surface it.
// ────────────────────────────────────────────────────────────────────────────

// Pin to a Sparticuz/chromium release. Bump when puppeteer-core moves a major
// version, otherwise leave alone — older releases stay available indefinitely
// on GitHub Releases. Tested combos:
//   puppeteer-core ^22.x  ↔  chromium-min ^126.0.0  ← current
//   puppeteer-core ^23.x  ↔  chromium-min ^131.x    (when we upgrade)
const CHROMIUM_PACK_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v126.0.0/chromium-v126.0.0-pack.tar';

// Allow ops to override (e.g., point at a self-hosted mirror for air-gapped
// envs or a private chromium fork). Empty string = use the default release.
const CHROMIUM_PACK_URL_OVERRIDE = process.env.CHROMIUM_PACK_URL || CHROMIUM_PACK_URL;

let _cachedExecPath = null;

// Common system-Chrome / Edge install paths per platform. Used when no
// PUPPETEER_EXECUTABLE_PATH is set and we're NOT in a serverless/Linux env.
// Order matters — Chrome before Edge.
function localChromiumCandidates() {
  const fs = require('node:fs');
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const platform = process.platform;
  let candidates = [];
  if (platform === 'win32') {
    candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      `${home}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`,
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
  } else if (platform === 'darwin') {
    candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  } else {
    // Linux desktop dev — not the Render path
    candidates = [
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
    ];
  }
  return candidates.filter(p => { try { return fs.existsSync(p); } catch { return false; } });
}

// Heuristic — are we in the Render/Lambda-style env where chromium-min works?
// Render sets RENDER=true. AWS Lambda sets AWS_LAMBDA_FUNCTION_NAME. Both Linux.
function isServerlessLinuxEnv() {
  if (process.platform !== 'linux') return false;
  return !!(process.env.RENDER || process.env.AWS_LAMBDA_FUNCTION_NAME ||
            process.env.VERCEL || process.env.NETLIFY);
}

export async function launchHeadlessBrowser({ args: extraArgs = [] } = {}) {
  const puppeteer = (await import('puppeteer-core')).default;
  const { createRequire } = await import('node:module');
  global.require = global.require || createRequire(import.meta.url);

  const standardArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
  ];

  // 1) Explicit override (any platform).
  const explicitPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (explicitPath) {
    return puppeteer.launch({
      headless: true,
      executablePath: explicitPath,
      args: [...standardArgs, ...extraArgs],
    });
  }

  // 2) Serverless Linux env (Render, Lambda) — Sparticuz/chromium-min.
  if (isServerlessLinuxEnv()) {
    const chromium = (await import('@sparticuz/chromium-min')).default;
    if (!_cachedExecPath) {
      _cachedExecPath = await chromium.executablePath(CHROMIUM_PACK_URL_OVERRIDE);
    }
    return puppeteer.launch({
      headless: chromium.headless,
      executablePath: _cachedExecPath,
      args: [...chromium.args, ...extraArgs],
    });
  }

  // 3) Local dev — auto-detect system Chrome / Edge. Avoids the "PDF came out
  //    as HTML" trap users hit when they forget to set the env var.
  const detected = localChromiumCandidates();
  if (detected.length > 0) {
    return puppeteer.launch({
      headless: true,
      executablePath: detected[0],
      args: [...standardArgs, ...extraArgs],
    });
  }

  // 4) Nothing usable — throw LOUDLY so renderPdf.js's catch block surfaces it
  //    rather than silently falling back to HTML buffers. The earlier silent
  //    fallback was the cause of both "PDFs are HTML" bugs (prod + local).
  throw new Error(
    'No Chromium available. ' +
    `Platform=${process.platform}, RENDER=${!!process.env.RENDER}. ` +
    'Set PUPPETEER_EXECUTABLE_PATH in .env to your local Chrome / Edge binary, ' +
    'or install Google Chrome to a standard location.'
  );
}
