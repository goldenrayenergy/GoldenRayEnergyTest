// POC — Cesium / Google Photorealistic 3D Tiles config route.
//
// GET /api/poc/3d/tileset-config
//   Returns the Photorealistic 3D Tileset root URL for Cesium to load. The
//   browser fetches this at scene-init time and uses it to stream tiles
//   directly from Google. The API key is embedded in the URL so it never
//   appears in client source or client environment.
//
// Security posture (POC → prod path):
//   POC: root.json URL is returned to the browser with the key in the
//        query string. Because Cesium then follows child-tile URLs from
//        that root, the key stays in-URL for tile fetches. Restrict the
//        Google Cloud key to Map Tiles API + your domains (Cloud Console
//        → Credentials → Edit key → API restrictions + HTTP referrer
//        restrictions) so a leaked URL can only be used from your origins.
//   Prod hardening (later): proxy root.json through this server + rewrite
//        child-tile URLs so the browser only sees relative paths that hit
//        this server as a tile proxy. Latency cost = one extra hop per
//        tile, so only worth it if key leakage becomes a real risk.

import { Router } from 'express';
import env from '../config/env.js';

const router = Router();

const TILESET_ROOT = 'https://tile.googleapis.com/v1/3dtiles/root.json';

router.get('/tileset-config', (_req, res) => {
  const key = env.googleSolar.apiKey;
  if (!key) {
    return res.status(503).json({
      error: 'GOOGLE_SOLAR_API_KEY not set. Photorealistic 3D Tiles unavailable. Enable "Map Tiles API" in Google Cloud for the same key.',
    });
  }
  return res.json({
    // URL Cesium.Cesium3DTileset(url) can load directly.
    tileset_url: `${TILESET_ROOT}?key=${encodeURIComponent(key)}`,
    // Google's TOS requires we display this attribution on every scene.
    attribution: 'Google · Vexcel Imaging US, Inc. · Data SIO, NOAA, U.S. Navy, NGA, GEBCO · Landsat / Copernicus · Airbus',
    // Default camera settings — Auckland CBD, safe smoke-test location.
    default_camera: {
      latitude:  -36.848461,
      longitude:  174.763336,
      height_m:  500,
      pitch_deg: -30,
      heading_deg: 0,
    },
  });
});

export default router;
