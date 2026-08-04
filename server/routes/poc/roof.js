// POC roof-analysis + aerial-image proxy routes.
//
// - POST /api/poc/roof/analyse — { address } → geocodes, calls Google Solar,
//   returns roof geometry + a proxied Google Static Maps URL for the
//   "is this your house?" screen. NO DB writes.
//
// - GET /api/poc/aerial/google?lat=&lng=&zoom= — server-side proxy for
//   Google Static Maps (satellite) so the API key never touches the browser.
//   Matches the exact imagery a customer sees on Google Maps for their
//   address, which is usually newer + more familiar than LINZ.
//
// - GET /api/poc/aerial/tile?z=&x=&y= — LINZ Basemap tile proxy (KEPT for
//   the panel-overlay screen in Slice 4; not used for the confirm screen
//   because LINZ can miss tiles at high zoom and its imagery date may
//   disagree with what Google Maps shows the customer).

import { Router } from 'express';
import env from '../../config/env.js';
import { createClient as createSolarClient } from '../../services/googleSolar/client.js';
import { createGeocoder }                     from '../../services/googleSolar/geocoder.js';
import { parseBuildingInsightsResponse,
         computeOptimalTileRadius }           from '../../services/googleSolar/analyseRoof.js';
import { chooseZoom,
         computeTileGrid,
         latLngToTileFrac,
         metersPerPixel }                     from '../../services/linz/aerialFetcher.js';
import { fetchTile as fetchLinzTile }         from '../../services/linz/basemapClient.js';

const router = Router();

// Lazy singletons — created on first request rather than at module load,
// so the routes module can be imported without env vars being set.
let _solarClient = null;
let _geocoder    = null;
function getSolarClient() {
  if (!_solarClient) _solarClient = createSolarClient();
  return _solarClient;
}
function getGeocoder() {
  if (!_geocoder) _geocoder = createGeocoder();
  return _geocoder;
}

// ── POST /api/poc/roof/analyse ────────────────────────────────────────────
// Accepts EITHER { place_id } (preferred — user picked from Places
// Autocomplete, coords are authoritative) OR { address } (legacy — falls
// back to Geocoding API which can lie about ROOFTOP quality for new
// subdivisions). Client should always prefer place_id when available.
router.post('/analyse', async (req, res) => {
  const { place_id: placeId, address } = req.body || {};
  if (!placeId && (!address || typeof address !== 'string' || !address.trim())) {
    return res.status(400).json({ error: 'Either place_id or address required in body.' });
  }

  // 1. Resolve to lat/lng. Prefer Places Details (Place ID → exact
  //    rooftop coord); fall back to Geocoding API only if no place_id.
  let geo;
  if (placeId) {
    try {
      const key = env.googleSolar.apiKey;
      if (!key) return res.status(503).json({ error: 'GOOGLE_SOLAR_API_KEY not set.' });
      const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;
      const resp = await fetch(url, {
        headers: {
          'X-Goog-Api-Key':   key,
          'X-Goog-FieldMask': 'id,formattedAddress,location',
        },
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        return res.status(resp.status).json({
          error: `Places details returned ${resp.status}: ${body.slice(0, 300)}`,
        });
      }
      const d = await resp.json();
      if (!d.location) {
        return res.status(502).json({ error: 'Places details returned no location for this placeId.' });
      }
      geo = {
        ok: true,
        source: 'places-api',
        latitude: d.location.latitude,
        longitude: d.location.longitude,
        formattedAddress: d.formattedAddress,
        quality: 'ROOFTOP',   // Places API results are always tied to a specific place, treat as rooftop
      };
    } catch (e) {
      return res.status(500).json({ error: `Places details fetch threw: ${e.message}` });
    }
  } else {
    try {
      geo = await getGeocoder().geocode(address);
    } catch (e) {
      return res.status(500).json({ error: `Geocoder threw: ${e.message}` });
    }
    if (!geo.ok) {
      return res.status(422).json({
        error: `Geocoding failed: ${geo.reason || 'unknown'} — ${geo.error || ''}`.trim(),
      });
    }
  }

  // 2. Google Solar buildingInsights with quality cascade (matches analyseRoof.js)
  const cascade = ['HIGH', 'MEDIUM', 'LOW'];
  let solarResp = null;
  let usedQuality = null;
  for (const quality of cascade) {
    const r = await getSolarClient().buildingInsights({
      latitude: geo.latitude, longitude: geo.longitude, requiredQuality: quality,
    });
    if (r.ok) { solarResp = r; usedQuality = quality; break; }
    // 404 = "no imagery at this quality" — keep cascading
    if (r.status !== 404) {
      return res.status(502).json({ error: `Google Solar error: ${r.status} ${r.error}` });
    }
  }
  if (!solarResp) {
    return res.status(404).json({
      error: `No solar imagery available for this address at any quality tier. Address may be too rural or outside Google's coverage.`,
      coords: { latitude: geo.latitude, longitude: geo.longitude },
      formattedAddress: geo.formattedAddress,
    });
  }

  const parsed = parseBuildingInsightsResponse(solarResp.data);
  const segments = parsed.roof_segments || [];

  // 3. Aerial imagery for the confirm-your-house screen — Google Static Maps.
  //    Zoom 19 = ~1.2 m/px at NZ latitudes → house + immediate neighbours in
  //    frame. 640x640 is the free-tier max size; @2x doubles pixel density
  //    without doubling the "size" for billing purposes.
  //    Client requests via /api/poc/aerial/google (proxy hides API key).
  const aerialZoom = 19;
  const aerialSize = '640x480';
  const aerialUrl  = `/api/poc/aerial/google?lat=${geo.latitude}&lng=${geo.longitude}&zoom=${aerialZoom}&size=${aerialSize}&marker=1`;

  return res.json({
    formattedAddress: geo.formattedAddress,
    coords:           { latitude: geo.latitude, longitude: geo.longitude },
    geocode_quality:  geo.quality,
    solar_source:     solarResp.source,   // 'live' | 'mock'
    used_quality:     usedQuality,
    imagery: {
      quality: parsed.imagery_quality,
      date:    parsed.imagery_date,
    },
    roof: {
      max_array_area_m2:               parsed.max_array_area_m2,
      max_array_panels_count:          parsed.max_array_panels_count,
      max_sunshine_hours_per_year:     parsed.max_sunshine_hours_per_year,
      carbon_offset_factor_kg_per_kwh: parsed.carbon_offset_factor_kg_per_kwh,
      segments,   // full array so the client can render per-face stats later
    },
    aerial: {
      source: 'google_static_maps',
      url:    aerialUrl,   // proxied so browser never sees the API key
      zoom:   aerialZoom,
      size:   aerialSize,
    },
  });
});

// ── Separate router for aerial proxies (Google Static Maps + LINZ tiles) ────
export const aerialRouter = Router();

// GET /api/poc/aerial/google?lat=&lng=&zoom=&size=&marker=
// Proxies Google Static Maps satellite imagery. Marker=1 drops a red pin at
// the exact lat/lng. Same GOOGLE_SOLAR_API_KEY (Static Maps API must be
// enabled in the Cloud Console for the same key).
aerialRouter.get('/google', async (req, res) => {
  const lat  = parseFloat(req.query.lat);
  const lng  = parseFloat(req.query.lng);
  const zoom = parseInt(req.query.zoom, 10) || 19;
  const size = /^[0-9]{2,4}x[0-9]{2,4}$/.test(req.query.size || '') ? req.query.size : '640x480';
  const withMarker = req.query.marker === '1';
  if (Number.isNaN(lat) || lat < -90 || lat > 90 || Number.isNaN(lng) || lng < -180 || lng > 180) {
    return res.status(400).json({ error: `Bad lat/lng: ${req.query.lat}, ${req.query.lng}` });
  }

  const key = env.googleSolar.apiKey;
  if (!key) {
    return res.status(503).json({
      error: 'GOOGLE_SOLAR_API_KEY not set — cannot fetch Google Static Maps. Reuses the Solar key; enable "Maps Static API" for it in the Google Cloud Console.',
    });
  }

  const params = new URLSearchParams({
    center:  `${lat},${lng}`,
    zoom:    String(zoom),
    size,
    scale:   '2',                // retina — free tier allows
    maptype: 'satellite',
    key,
  });
  if (withMarker) {
    params.append('markers', `color:0xD9531E|size:mid|${lat},${lng}`);
  }
  const url = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return res.status(resp.status).json({
        error: `Google Static Maps returned ${resp.status}: ${body.slice(0, 300)}`,
      });
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    res.setHeader('Content-Type',  resp.headers.get('content-type') || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.end(buf);
  } catch (e) {
    return res.status(500).json({ error: `Google Static Maps proxy threw: ${e.message}` });
  }
});

aerialRouter.get('/tile', async (req, res) => {
  const z = parseInt(req.query.z, 10);
  const x = parseInt(req.query.x, 10);
  const y = parseInt(req.query.y, 10);
  if (!Number.isInteger(z) || z < 0 || z > 22
      || !Number.isInteger(x) || x < 0
      || !Number.isInteger(y) || y < 0) {
    return res.status(400).json({ error: `Bad tile coords: z=${z} x=${x} y=${y}` });
  }

  try {
    const t = await fetchLinzTile({ z, x, y });
    if (!t.ok) {
      return res.status(t.status || 502).json({ error: `LINZ tile fetch failed: ${t.error}` });
    }
    res.setHeader('Content-Type',  t.contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // tiles are immutable per zXY at LINZ
    return res.end(t.buffer);
  } catch (e) {
    return res.status(500).json({ error: `LINZ tile proxy threw: ${e.message}` });
  }
});

export default router;
