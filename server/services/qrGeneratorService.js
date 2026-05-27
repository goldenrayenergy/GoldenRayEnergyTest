// ────────────────────────────────────────────────────────────────────────────
// QR generator — renders the URL `${baseUrl}/qr/${slug}` as either:
//   • PNG (2048×2048) with circular white background + Goldenray logo centred
//   • SVG (vector, infinitely scalable — required for large-format banners)
//
// Logo overlay uses error-correction level H (~30% redundancy), so the
// centre ~15% of the QR is safely obscured by the logo and still scans.
// ────────────────────────────────────────────────────────────────────────────

import QRCode from 'qrcode';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve the Goldenray logo from client/public/. Cached after first load.
let _logoBuffer = null;
function getLogoBuffer() {
  if (_logoBuffer) return _logoBuffer;
  const candidates = [
    path.resolve(__dirname, '../../client/public/logo.jpg'),
    path.resolve(__dirname, '../../client/public/logo.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      _logoBuffer = fs.readFileSync(p);
      return _logoBuffer;
    }
  }
  return null;
}

const QR_OPTIONS = {
  errorCorrectionLevel: 'H',  // 30% redundancy — required for centre logo
  margin: 2,                   // quiet zone (in modules) — needed for reliable scan
  color: { dark: '#000000', light: '#FFFFFF' },
};

// ── PNG (2048×2048) ────────────────────────────────────────────────────────
//
// Pipeline:
//   1. QRCode.toBuffer → 2048-px black-on-white PNG
//   2. Generate a circular logo badge (white disc + logo image, both clipped
//      to the disc) sized at 15% of the QR side (~307 px on a 2048 px QR)
//   3. Composite the badge dead-centre on the QR
export async function generateQrPng(url, { size = 2048 } = {}) {
  // Step 1: base QR
  const qrPng = await QRCode.toBuffer(url, { ...QR_OPTIONS, type: 'png', width: size });

  const logoBuf = getLogoBuffer();
  if (!logoBuf) {
    // Fall back to plain QR if the logo isn't found at build time.
    return qrPng;
  }

  // Step 2: badge = circular white disc + logo clipped to it
  const badgeSize = Math.round(size * 0.18);  // 18% of QR side
  const logoInner = Math.round(badgeSize * 0.78); // logo fills ~78% of the disc (rest is white margin)

  // Render the white disc via SVG, then composite the logo on top with the
  // disc as its alpha mask — keeps the corners of the logo image clipped to
  // a circle without us needing a separate mask image.
  const discSvg = Buffer.from(
    `<svg width="${badgeSize}" height="${badgeSize}" xmlns="http://www.w3.org/2000/svg">
       <circle cx="${badgeSize/2}" cy="${badgeSize/2}" r="${badgeSize/2}" fill="white"/>
     </svg>`
  );

  // Resize the logo to fit inside the disc (with 11% white margin around)
  const logoResized = await sharp(logoBuf)
    .resize(logoInner, logoInner, { fit: 'inside', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .toBuffer();

  // Build the badge: disc PNG + logo centred on top
  const badge = await sharp(discSvg)
    .composite([{ input: logoResized, gravity: 'center' }])
    .png()
    .toBuffer();

  // Step 3: composite badge onto the QR
  return await sharp(qrPng)
    .composite([{ input: badge, gravity: 'center' }])
    .png()
    .toBuffer();
}

// ── SVG (vector) ───────────────────────────────────────────────────────────
//
// Pipeline:
//   1. QRCode.toString → SVG XML
//   2. Inject a <g> at the end containing a white <circle> + base64-embedded
//      <image> for the logo, both centred. The SVG viewBox tells us the
//      exact centre coordinates.
export async function generateQrSvg(url) {
  const baseSvg = await QRCode.toString(url, { ...QR_OPTIONS, type: 'svg' });

  const logoBuf = getLogoBuffer();
  if (!logoBuf) return baseSvg;

  // Pull viewBox from the SVG header so the overlay scales correctly. qrcode
  // lib emits something like: <svg viewBox="0 0 33 33" ...>
  const vbMatch = baseSvg.match(/viewBox="0 0 (\d+) (\d+)"/);
  if (!vbMatch) return baseSvg; // safety — return plain QR if structure changed
  const vw = parseInt(vbMatch[1], 10);
  const vh = parseInt(vbMatch[2], 10);

  // Badge geometry in viewBox units
  const cx = vw / 2;
  const cy = vh / 2;
  const discR  = vw * 0.09;          // 18% diameter → 9% radius
  const logoSz = vw * 0.14;          // logo a touch smaller than the disc
  const logoX  = cx - logoSz / 2;
  const logoY  = cy - logoSz / 2;

  // Detect logo MIME from the buffer's magic bytes
  const isPng = logoBuf[0] === 0x89 && logoBuf[1] === 0x50;
  const mime  = isPng ? 'image/png' : 'image/jpeg';
  const logoB64 = logoBuf.toString('base64');

  const overlay =
    `<circle cx="${cx}" cy="${cy}" r="${discR}" fill="#FFFFFF"/>` +
    `<image x="${logoX}" y="${logoY}" width="${logoSz}" height="${logoSz}" ` +
    `href="data:${mime};base64,${logoB64}" preserveAspectRatio="xMidYMid meet"/>`;

  return baseSvg.replace('</svg>', `${overlay}</svg>`);
}

// ── Convenience: build the full URL the QR will encode ─────────────────────
export function buildQrUrl(baseUrl, slug) {
  const trimmed = String(baseUrl || '').replace(/\/+$/, '');
  return `${trimmed}/qr/${slug}`;
}
