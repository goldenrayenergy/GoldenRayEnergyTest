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

export async function launchHeadlessBrowser({ args: extraArgs = [] } = {}) {
  const puppeteer = (await import('puppeteer-core')).default;

  // 1) If the operator has set PUPPETEER_EXECUTABLE_PATH (typical for local
  //    dev with a system Chrome), use that directly. Skips the download step.
  const explicitPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (explicitPath) {
    return puppeteer.launch({
      headless: true,
      executablePath: explicitPath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        ...extraArgs,
      ],
    });
  }

  // 2) Production / containerised path — Sparticuz/chromium-min. Cached on
  //    first call; subsequent calls reuse the downloaded binary path.
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
