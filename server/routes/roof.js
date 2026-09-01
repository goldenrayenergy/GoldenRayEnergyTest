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
import env from '../config/env.js';
import { createClient as createSolarClient } from '../services/googleSolar/client.js';
import { createGeocoder }                     from '../services/googleSolar/geocoder.js';
import { parseBuildingInsightsResponse,
         computeOptimalTileRadius }           from '../services/googleSolar/analyseRoof.js';
import { chooseZoom,
         computeTileGrid,
         latLngToTileFrac,
         metersPerPixel }                     from '../services/linz/aerialFetcher.js';
import { fetchTile as fetchLinzTile }         from '../services/linz/basemapClient.js';
import { queryBuildingsNear,
         buildingContaining,
         nearestBuilding }                    from '../services/linz/buildingOutlines.js';
import { queryOsmBuildingsNear }              from '../services/osm/buildingOutlines.js';
import { queryParcelsNear,
         parcelContaining,
         nearestParcel }                      from '../services/linz/parcels.js';
import { findOverrideForCoords }              from './pm/polygon-overrides.js';
import { analyseRoofFromLidar }               from '../services/linz/lidarAnalyseRoof.js';
import { getPvgisClient }                     from '../services/pvgis/pvgisClient.js';
import { computePvgisYieldForSegments }       from '../services/pvgis/pvgisSegmentYield.js';

// Try OSM first (crowdsourced, current), fall back to LINZ (2017-era for
// Auckland but authoritative when it has data), then return whichever
// yielded a polygon containing OR nearest to the requested point. Returns
// { building, source, tried: [...] } or { building: null, tried: [...] }.
async function findCustomerBuilding({ latitude, longitude }) {
  const tried = [];

  // Round 4 (2026-08-26) — Bug 7/8. Threshold for "nearest building
  // is close enough to be this address" was 15m. That threshold was
  // tuned against dense Auckland/Wellington neighbourhoods where every
  // rooftop is in OSM and picking the wrong neighbour is a real risk.
  //
  // In sparse-OSM areas (Queenstown, Kāpiti Coast, new subdivisions
  // anywhere) the ACTUAL customer roof is often absent from OSM and
  // the "nearest" candidate is a neighbour 20-25m away. The old 15m
  // gate rejected these — the pipeline then fell through to LiDAR
  // with a synthesised polygon centred on the Places pin, which
  // frequently sits in the driveway, not on the roof.
  //
  // NEW: two-tier acceptance. If OSM/LINZ returned MANY candidates in
  // the 40m search (dense area), keep the strict 15m gate. If only 1-2
  // candidates came back (sparse area), loosen to 25m. Threshold picked
  // so a rural plot with two houses on the section still lands on the
  // right one, while a suburban address with 8 neighbours doesn't
  // accidentally match the next-door lot.
  const acceptDistance = (buildings) => (buildings.length >= 3 ? 15 : 25);

  // -1. Manual polygon override — TRIED BEFORE ANYTHING ELSE (Layer 3 /
  //     Session 2, 2026-08-28). Owner-managed table for the ~16% of NZ
  //     addresses where Google Solar + LINZ Parcels + OSM + LINZ
  //     Buildings all give the wrong roof. When present, this polygon
  //     is used verbatim as the building outline for polygon-clip AND
  //     (optionally) its segments_override bypasses Google Solar / LiDAR
  //     roof-face identification entirely. Owner draws these via the
  //     admin UI at /admin/polygon-overrides.
  try {
    const override = await findOverrideForCoords({ latitude, longitude, radiusMeters: 20 });
    tried.push({ source: 'manual-override', ok: true, count: override ? 1 : 0, error: null });
    if (override) {
      return {
        building: {
          id:         override.id,
          properties: { source: 'admin_override', notes: override.notes, override_id: override.id },
          centroid:   { latitude: Number(override.latitude), longitude: Number(override.longitude) },
          polygon:    override.polygon,     // already [[[lng,lat],...]] rings
          area_m2:    null,                 // could compute but not needed downstream
          distance_m: override._distanceM ?? 0,
        },
        source:            'manual-override',
        match_type:        'containing',    // an override is BY DEFINITION the customer's building
        tried,
        max_dist_m_used:   0,
        segments_override: override.segments_override || null,   // consumed by main handler
      };
    }
  } catch (e) {
    tried.push({ source: 'manual-override', ok: false, count: 0, error: e?.message || String(e) });
  }

  // 0. LINZ Parcels — TRIED FIRST (2026-08-27). The NZ cadastral dataset
  //    (LINZ layer 50823) gives the LEGAL per-property boundary. For
  //    unit-titled townhouses, semi-detached homes, and cross-lease
  //    developments — ~20-30% of urban NZ housing — this is the ONLY
  //    source that isolates the customer's specific unit. Building
  //    outlines (both OSM and LINZ layer 101290) merge all units in a
  //    row into a single physical-structure polygon, causing panels to
  //    render on the wrong unit's roof (10 Newnham Terrace bug).
  //
  //    Only accept the CONTAINING parcel — no "nearest" fallback. If
  //    Places lat/lng doesn't fall inside any parcel, the address is
  //    probably rural / newly-subdivided / on shared land, and building
  //    outlines are more appropriate. Also skip if the containing parcel
  //    is HUGE (>5000 m²) — that's a farm / reserve / school, where the
  //    physical building polygon is more useful than the whole land.
  try {
    const parcels = await queryParcelsNear({ latitude, longitude, radiusMeters: 30 });
    tried.push({ source: 'linz-parcel', ok: parcels.ok, count: parcels.parcels?.length ?? 0, error: parcels.error || null });
    if (parcels.ok && parcels.parcels.length > 0) {
      const containing = parcelContaining(parcels.parcels, latitude, longitude);
      if (containing && containing.area_m2 > 0 && containing.area_m2 <= 5000) {
        return {
          building: containing,
          source: 'linz-parcel',
          match_type: 'containing',
          tried,
          max_dist_m_used: 0,
        };
      }
    }
  } catch (e) {
    // Missing API-key config, network failure, etc. — non-fatal, fall
    // through to OSM/LINZ Buildings. Logging so we notice silent
    // regressions (e.g. key rotated but .env not updated).
    tried.push({ source: 'linz-parcel', ok: false, count: 0, error: e?.message || String(e) });
  }

  // 1. OSM primary
  const osm = await queryOsmBuildingsNear({ latitude, longitude, radiusMeters: 40 });
  tried.push({ source: 'osm', ok: osm.ok, count: osm.buildings?.length ?? 0, error: osm.error || null });
  if (osm.ok && osm.buildings.length > 0) {
    const containing = buildingContaining(osm.buildings, latitude, longitude);
    const nearest    = nearestBuilding(osm.buildings);
    const maxDistM   = acceptDistance(osm.buildings);
    const picked = containing || (nearest && nearest.distance_m <= maxDistM ? nearest : null);
    if (picked) return { building: picked, source: 'osm', match_type: containing ? 'containing' : 'nearest', tried, max_dist_m_used: maxDistM };
  }

  // 2. LINZ fallback
  const linz = await queryBuildingsNear({ latitude, longitude, radiusMeters: 40 });
  tried.push({ source: 'linz', ok: linz.ok, count: linz.buildings?.length ?? 0, error: linz.error || null });
  if (linz.ok && linz.buildings.length > 0) {
    const containing = buildingContaining(linz.buildings, latitude, longitude);
    const nearest    = nearestBuilding(linz.buildings);
    const maxDistM   = acceptDistance(linz.buildings);
    const picked = containing || (nearest && nearest.distance_m <= maxDistM ? nearest : null);
    if (picked) return { building: picked, source: 'linz', match_type: containing ? 'containing' : 'nearest', tried, max_dist_m_used: maxDistM };
  }

  return { building: null, source: null, match_type: null, tried };
}

// ── Per-address solar yield from Google Solar's own `sunshineQuantiles` ───
// Google Solar returns 11 sunshine quantiles per roof segment, in units of
// annual kWh/kW capacity (already accounts for the segment's tilt + azimuth
// vs local irradiance). We use the median (index 5) as the segment's yield,
// then take an area-weighted mean across the segments that would actually
// carry panels (viable-face filter identical to selectViableSegments on the
// client — north-ish, non-vertical, big enough).
// Returns null if not enough data. The client falls back to regional yield
// (engineeringRules.REGIONS) in that case.
function computeSystemYieldKwhPerKwpPerYear(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const MIN_AREA_M2 = 10;
  const MAX_PITCH_DEG = 55;
  let weightSum = 0;
  let weightedYieldSum = 0;
  let contributingSegments = 0;
  for (const s of segments) {
    const area = Number(s?.stats?.areaMeters2) || 0;
    const pitch = Number(s?.pitchDegrees) || 0;
    const az = Number(s?.azimuthDegrees) || 0;
    if (area < MIN_AREA_M2) continue;
    if (pitch < 0 || pitch > MAX_PITCH_DEG) continue;
    // Skip S-facing (distFromN > 135) — never carries panels in NZ.
    const azNorm = ((az % 360) + 360) % 360;
    const distFromNorth = Math.min(azNorm, 360 - azNorm);
    if (distFromNorth > 135) continue;
    const q = s?.stats?.sunshineQuantiles;
    if (!Array.isArray(q) || q.length < 6) continue;
    const median = Number(q[Math.floor(q.length / 2)]);
    if (!Number.isFinite(median) || median <= 0) continue;
    weightSum += area;
    weightedYieldSum += area * median;
    contributingSegments++;
  }
  if (contributingSegments === 0 || weightSum <= 0) return null;
  return {
    kwh_per_kwp_per_year: Number((weightedYieldSum / weightSum).toFixed(0)),
    source: 'google_sunshine_quantiles',
    contributing_segments: contributingSegments,
  };
}

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
// Request-lifecycle diagnostic for issue #2 (intermittent empty-body 500s
// seen in the browser but never reproducible from curl). Logs when the
// server RECEIVES the request and again when it FINISHES sending a
// response, with elapsed time and status. When a browser sees an
// empty-body 500 we can compare: if the server logs a matching
// STARTED → COMPLETED with status 200, the 500 came from the proxy
// layer or a socket-level reset, not our code.
router.post('/analyse', async (req, res) => {
  const rid = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const t0 = Date.now();
  const clientCloseReported = { flag: false };
  console.log(`[poc/roof/analyse] ${rid} STARTED ${req.body?.place_id ? 'placeId=' + req.body.place_id.slice(0, 20) + '…' : 'address=' + (req.body?.address || '').slice(0, 40)}`);
  req.on('close', () => {
    if (!res.writableEnded) {
      clientCloseReported.flag = true;
      console.warn(`[poc/roof/analyse] ${rid} CLIENT-DISCONNECTED after ${Date.now() - t0}ms — client (browser/proxy) closed the socket before we finished responding. Empty-body 500 in the browser is the proxy signalling this.`);
    }
  });
  res.on('finish', () => {
    if (!clientCloseReported.flag) {
      console.log(`[poc/roof/analyse] ${rid} COMPLETED status=${res.statusCode} elapsed=${Date.now() - t0}ms`);
    }
  });
  try {
    return await _analyse(req, res);
  } catch (e) {
    console.error(`[poc/roof/analyse] ${rid} UNCAUGHT-THROW after ${Date.now() - t0}ms:`, e);
    if (!res.headersSent) {
      return res.status(500).json({ error: `Uncaught: ${e.message || String(e)}`, rid });
    }
  }
});

async function _analyse(req, res) {
  const { place_id: placeId, address, lat_override, lng_override } = req.body || {};
  if (!placeId && (!address || typeof address !== 'string' || !address.trim())) {
    return res.status(400).json({ error: 'Either place_id or address required in body.' });
  }

  // 2026-08-18 — customer can drag a pin on PreviewStage to nudge the geocode
  // onto their actual building (handles: pin on the road, pin on neighbour,
  // multi-building properties, rural mailbox-vs-house offset). If provided,
  // both values must be finite + within valid lat/lng bounds. We still call
  // the geocoder below to get the formattedAddress; the coords just get
  // overridden right after so everything downstream (findCustomerBuilding,
  // Google Solar, LiDAR) uses the customer's pick.
  let override = null;
  if (lat_override != null || lng_override != null) {
    const lat = Number(lat_override);
    const lng = Number(lng_override);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return res.status(400).json({ error: `Bad lat_override/lng_override: ${lat_override}, ${lng_override}` });
    }
    override = { latitude: lat, longitude: lng };
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

  // Apply the customer's pin-drag override AFTER geocoding — we keep the
  // formattedAddress from Places but swap the coords. quality bumps to
  // ROOFTOP because the customer explicitly placed the pin.
  if (override) {
    console.log(`[poc/roof/analyse] pin override: ${geo.latitude.toFixed(6)},${geo.longitude.toFixed(6)} -> ${override.latitude.toFixed(6)},${override.longitude.toFixed(6)}`);
    geo.latitude  = override.latitude;
    geo.longitude = override.longitude;
    geo.quality   = 'ROOFTOP';
    geo.source    = geo.source ? `${geo.source}+pin-override` : 'pin-override';
  }

  // 2. Find the customer's actual building polygon (OSM primary, LINZ fallback).
  //    This becomes the ground truth for the panel overlay — we no longer
  //    trust Google Solar's building matching for this.
  const buildingLookup = await findCustomerBuilding({
    latitude: geo.latitude, longitude: geo.longitude,
  });

  // The coord we send to Google Solar. If we found the customer's actual
  // building via OSM/LINZ, use its centroid — that's the strongest signal
  // to Google Solar about which building we care about. If we didn't find
  // it, fall back to the Places coord.
  const solarLookupCoord = buildingLookup.building
    ? buildingLookup.building.centroid
    : { latitude: geo.latitude, longitude: geo.longitude };

  // 3. Google Solar buildingInsights with quality cascade (matches analyseRoof.js)
  const cascade = ['HIGH', 'MEDIUM', 'LOW'];
  let solarResp = null;
  let usedQuality = null;
  for (const quality of cascade) {
    const r = await getSolarClient().buildingInsights({
      latitude: solarLookupCoord.latitude, longitude: solarLookupCoord.longitude, requiredQuality: quality,
    });
    if (r.ok) { solarResp = r; usedQuality = quality; break; }
    // 404 = "no imagery at this quality" — keep cascading
    if (r.status !== 404) {
      return res.status(502).json({ error: `Google Solar error: ${r.status} ${r.error}` });
    }
  }

  // 3b. LiDAR FALLBACK — triggered in TWO cases:
  //     (a) Google Solar returned 404 at all quality tiers (rural / new area)
  //     (b) Google Solar SUCCEEDED but we couldn't verify the building via
  //         OSM/LINZ. In new subdivisions the building polygon isn't in OSM
  //         yet, and Google Solar's imagery is often stale (2016-era), so
  //         its segments describe what USED to be at those coords — often
  //         an empty lot or a demolished house. Panels rendered from those
  //         segments end up on today's roads or driveways.
  //         Rule: no verified building = don't trust Google Solar.
  //
  //     The 2024 LINZ LiDAR survey covers Auckland and produces accurate
  //     roof planes from current data, so it's the honest fallback for
  //     both cases.
  let parsed;
  let sourceTag = 'google';                 // 'google' | 'lidar' | 'mock'
  let lidarDiagnostics = null;
  let fallbackReason = null;                 // human-readable why we fell back
  const segments = [];                       // populated below either way

  // P1a fix (2026-08-31) — track whether Google Solar SUCCEEDED for this
  // coord at any quality tier, BEFORE any later invalidation. Layer 2 may
  // null out `solarResp` because the identified segments are on the wrong
  // building, and the LiDAR path resets `sourceTag = 'lidar'`. That loses
  // the fact that Cesium's 3D tiles likely have good coverage here
  // (Google Solar and Cesium Photorealistic 3D Tiles come from the same
  // Google dataset — if one has imagery, the other usually does too).
  //
  // The `renderMode` decision at the bottom of this handler uses this
  // flag to allow 3D rendering with LiDAR-derived segments (which are on
  // the CORRECT building, per LINZ parcel) instead of forcing 2D purely
  // because sourceTag is no longer 'live'.
  const googleSolarInitiallySucceeded = !!solarResp;

  const shouldTryLidarOverride = solarResp && !buildingLookup.building;
  if (shouldTryLidarOverride) {
    console.log('[poc/roof/analyse] Google Solar succeeded but no verified building — attempting LiDAR override for stale-imagery risk');
    fallbackReason = 'no_verified_building';
    // Force the fallback path below.
    solarResp = null;
  }

  if (solarResp) {
    // Google Solar path — trust it (building is verified via OSM/LINZ).
    parsed = parseBuildingInsightsResponse(solarResp.data);
    segments.push(...(parsed.roof_segments || []));
    sourceTag = solarResp.source;

    // Layer 2 (2026-08-27) — validate that Google Solar's identified
    // segments are ON the customer's LINZ parcel. If NONE of the segment
    // centres fall inside the parcel, Google Solar identified the wrong
    // building (e.g. 6 Woodacre Street Flat Bush Auckland: 9 segments
    // all 14-35m from Places pin, all outside the 401m² parcel — they're
    // on neighbouring rooftops). Force LiDAR fallback in that case —
    // LiDAR uses the LINZ parcel polygon as its RANSAC boundary so
    // segments are guaranteed on the customer's actual roof.
    const parcelRing = buildingLookup.building?.polygon?.[0];
    if (Array.isArray(parcelRing) && parcelRing.length >= 3 && segments.length > 0) {
      const pip = (lat, lng) => {
        let inside = false;
        for (let i = 0, j = parcelRing.length - 1; i < parcelRing.length; j = i++) {
          const xi = parcelRing[i][0], yi = parcelRing[i][1];
          const xj = parcelRing[j][0], yj = parcelRing[j][1];
          if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
      };
      const insideCount = segments.filter(s => pip(s?.center?.latitude, s?.center?.longitude)).length;
      if (insideCount === 0) {
        console.log(`[poc/roof/analyse] Google Solar returned ${segments.length} segments but 0 inside LINZ parcel — forcing LiDAR fallback`);
        fallbackReason = 'segments_outside_parcel';
        parsed = null;
        segments.length = 0;
        solarResp = null;
      }
    }
  }

  if (!solarResp) {
    // LiDAR path — Google Solar was either absent or overridden.
    const outerRing = buildingLookup.building?.polygon?.[0] || null;
    const lidar = await analyseRoofFromLidar({
      latitude:        geo.latitude,
      longitude:       geo.longitude,
      buildingPolygon: outerRing,
    });

    if (lidar.ok) {
      // LiDAR succeeded — use it.
      parsed = lidar.result;
      segments.push(...(parsed.roof_segments || []));
      sourceTag = 'lidar';
      lidarDiagnostics = parsed._diagnostics;
      usedQuality = 'LIDAR';
      solarResp = {
        source: 'lidar',
        data: {
          center: buildingLookup.building?.centroid || { latitude: geo.latitude, longitude: geo.longitude },
          solarPotential: {
            solarPanels: [],
            panelHeightMeters:  0.99,
            panelWidthMeters:   1.65,
            panelCapacityWatts: 400,
          },
        },
      };
    } else if (fallbackReason === 'no_verified_building' || fallbackReason === 'segments_outside_parcel') {
      // LiDAR override failed — roll back to Google Solar (imperfect but present).
      // Any render is better than no render — customer can see something + book survey.
      console.log(`[poc/roof/analyse] LiDAR override failed (fallbackReason=${fallbackReason}), rolling back to Google Solar:`, lidar.error);
      for (const quality of cascade) {
        const r = await getSolarClient().buildingInsights({
          latitude: solarLookupCoord.latitude, longitude: solarLookupCoord.longitude, requiredQuality: quality,
        });
        if (r.ok) { solarResp = r; usedQuality = quality; break; }
      }
      if (!solarResp) {
        return res.status(500).json({
          error: `Google Solar rollback also failed after LiDAR fallback rejected the request.`,
        });
      }
      parsed = parseBuildingInsightsResponse(solarResp.data);
      segments.push(...(parsed.roof_segments || []));
      sourceTag = solarResp.source;
      fallbackReason = 'lidar_failed_reverted_to_stale_google';
    } else {
      // Google Solar 404 + LiDAR failed — no data anywhere.
      // Round 4 (2026-08-26) — include the diagnostics block on error too
      // so the client's "we could not analyse this roof" card can render
      // which specific stage broke (building not found vs LiDAR gate hit
      // vs Cesium sample failure). Without this the UI has no way to
      // distinguish "we don't have data here" from "we had data but the
      // algorithm rejected it."
      return res.status(404).json({
        error: `No solar imagery from Google AND LiDAR fallback failed: ${lidar.error}`,
        coords: { latitude: geo.latitude, longitude: geo.longitude },
        formattedAddress: geo.formattedAddress,
        building_lookup: buildingLookup,
        roof_analysis_diagnostics: {
          source_pipeline:       'none',
          fallback_reason:       'both_pipelines_failed',
          google_solar_error:    'no_imagery_at_coord',
          lidar_error:           lidar.error,
          building_source:       buildingLookup.source,
          building_match_type:   buildingLookup.match_type,
          building_distance_m:   buildingLookup.building?.distance_m ?? null,
          building_candidates: (buildingLookup.tried || []).reduce(
            (acc, t) => { acc[t.source] = t.count; return acc; }, {}),
        },
      });
    }
  }

  // 3. Aerial imagery for the confirm-your-house screen — Google Static Maps.
  //    Wide view (z=19) for address confirmation, tight view (z=21) for the
  //    panel-overlay screen. Two separate images so each screen shows what
  //    it needs.
  //    Client requests via /api/poc/aerial/google (proxy hides API key).
  //
  // IMPORTANT: the tight aerial centres on the OSM/LINZ building centroid
  // (customer's actual house), NOT Places coord and NOT Google Solar's
  // building center. Google Solar routinely picks the wrong building in new
  // NZ subdivisions where its imagery is stale. Anchoring the aerial and
  // overlay math on the community-verified OSM polygon guarantees we're
  // rendering the customer's actual house.
  //
  // Precedence:
  //   1. OSM/LINZ building centroid IF the polygon is within 15m of the
  //      Places-verified rooftop coord (findCustomerBuilding enforces this).
  //   2. Otherwise → Places coord. Google Solar's building-center is not a
  //      trustworthy fallback because it draws from the same 2016-era imagery
  //      that also stales LINZ; when both are wrong they can agree on the
  //      wrong building.
  const googleCenter    = solarResp.data?.center || null;
  const buildingCenter  = buildingLookup.building?.centroid || null;
  const authoritativeCenter =
      buildingCenter ||
      { latitude: geo.latitude, longitude: geo.longitude };

  const aerialZoom      = 19;   // wide: property + neighbours (for "is this your house")
  const aerialTightZoom = 21;   // tight: fills frame with just the roof (for panel overlay)
  const aerialSize      = '640x480';
  const aerialUrl       = `/api/aerial/google?lat=${geo.latitude}&lng=${geo.longitude}&zoom=${aerialZoom}&size=${aerialSize}&marker=1`;
  const aerialTightUrl  = `/api/aerial/google?lat=${authoritativeCenter.latitude}&lng=${authoritativeCenter.longitude}&zoom=${aerialTightZoom}&size=${aerialSize}&marker=0`;

  // Divergence between Google Solar's guess and the ground-truth polygon —
  // if we have both and they're far apart, Google Solar analysed a different
  // building. The UI can warn about this.
  const googleVsBuildingShiftM = googleCenter && buildingCenter
    ? Math.round(Math.sqrt(
        Math.pow((googleCenter.latitude  - buildingCenter.latitude)  * 111320, 2) +
        Math.pow((googleCenter.longitude - buildingCenter.longitude) * 111320 * Math.cos(buildingCenter.latitude * Math.PI / 180), 2)
      ))
    : null;

  // Layer 1 (2026-08-27) — Places-vs-parcel-centroid offset. If Google
  // Places geocodes the address to a spot far from the LINZ parcel's
  // centroid, Google Solar will identify roof segments on the wrong
  // building (e.g. 31A Hillview Auckland: 16m offset → panels on
  // neighbour). Client uses this to require pin-drag confirmation
  // before running the analyse — see PreviewStage / Step 2 gating.
  const placesVsParcelShiftM = buildingCenter
    ? Math.round(Math.sqrt(
        Math.pow((geo.latitude  - buildingCenter.latitude)  * 111320, 2) +
        Math.pow((geo.longitude - buildingCenter.longitude) * 111320 * Math.cos(buildingCenter.latitude * Math.PI / 180), 2)
      ))
    : null;
  const PIN_DRAG_THRESHOLD_M = 5;   // above this we ask customer to drag pin
  const placementConfidence  = placesVsParcelShiftM == null      ? 'unknown'
                             : placesVsParcelShiftM <= PIN_DRAG_THRESHOLD_M ? 'high'
                             : placesVsParcelShiftM <= 15                   ? 'medium'
                             :                                                 'low';

  // Week-7 Phase 1: per-address yield from Google Solar's `sunshineQuantiles`.
  // Only produces a value on the Google Solar path (LiDAR-fallback segments
  // don't carry Google's per-pixel sunshine data). When null, we fall through
  // to Phase 2 (PVGIS) below, then finally to the regional REGIONS yield.
  let systemYield = computeSystemYieldKwhPerKwpPerYear(segments);
  let pvgisDiagnostics = null;

  // Week-7 Phase 2: PVGIS fallback for LiDAR-path addresses (or any address
  // where Google's sunshine data isn't available). Queries the European
  // Commission's PVGIS v5.3 API (free, no key, no auth) per viable segment
  // with the segment's actual tilt+azimuth, then area-weighted-averages.
  // Non-blocking-on-failure: if PVGIS is unreachable or all queries fail,
  // systemYield stays null and downstream design.compose falls back to the
  // regional default. Successful PVGIS results also attach a per-segment
  // `_yieldKwhPerKwp` onto each segment so the client-side per-panel yield
  // computation works uniformly across Google-Solar and LiDAR paths.
  if (!systemYield && segments.length > 0) {
    try {
      const pvgisResult = await computePvgisYieldForSegments({
        latitude:  geo.latitude,
        longitude: geo.longitude,
        segments,
        pvgisClient: getPvgisClient(),
      });
      pvgisDiagnostics = pvgisResult.diagnostics;
      if (pvgisResult.systemYield) {
        systemYield = pvgisResult.systemYield;
        // Attach per-segment yield so panelGrid.js can populate per-panel
        // yieldEstEnergyKwh the same way it does for Google-Solar segments.
        for (const ps of pvgisResult.perSegmentYields) {
          if (segments[ps.segmentIndex] && Number.isFinite(ps.kwhPerKwpPerYear)) {
            segments[ps.segmentIndex]._yieldKwhPerKwpPerYear = ps.kwhPerKwpPerYear;
            segments[ps.segmentIndex]._yieldSource = 'pvgis';
          }
        }
      }
    } catch (e) {
      // PVGIS failure MUST NOT break the analyse endpoint. Log and fall
      // through — design.compose will use regional yield as backup.
      console.warn('[poc/roof/analyse] PVGIS fallback threw:', e?.message || e);
      pvgisDiagnostics = { attempted: 0, succeeded: 0, failed: 0, cacheHits: 0, threw: String(e?.message || e) };
    }
  }

  // Path B (2026-08-26) — hybrid 3D/2D render mode decision. Google's
  // Photorealistic 3D Tiles have great coverage in major NZ cities
  // (Auckland, Wellington, Christchurch, Dunedin) but patchy quality in
  // regional/hillside/rural areas (Queenstown, Kāpiti fringe, small
  // towns). Rendering the Cesium 3D scene when the underlying mesh is
  // low-quality produces the "panels floating in sky" complaint — the
  // panel coords are right but Cesium's mesh doesn't accurately show
  // the actual building.
  //
  // Heuristic: use 3D when Google Solar's own pipeline succeeded (its
  // imagery + roof-detection is good for this area, which correlates
  // strongly with Cesium 3D Tiles coverage — Google publishes both from
  // the same underlying source). Fall back to 2D whenever we had to
  // resort to LiDAR (which by definition means Google's data for this
  // spot isn't great, so Cesium tiles are unlikely to be either).
  //
  // sourceTag values from the analysis pipeline above:
  //   'live'  → Google Solar succeeded (also used in the mock-fallback
  //             path but that only fires in dev without a Google API key)
  //   'lidar' → LiDAR fallback was used
  //   'mock'  → mock data (dev only)
  //
  // We also require a building polygon to be found + verified as
  // 'containing' the address pin — that guarantees the panel overlay
  // has a real footprint to sit on. `nearest` matches are ambiguous
  // (could be a neighbour), so we conservatively route them to 2D too.
  // 2026-08-27 (Option 3) — 2D-fallback trigger for cross-lease /
  // townhouse-row / multi-unit developments where LINZ parcel = shared
  // land title, not per-unit. Detected via long-thin parcel bbox
  // (aspect > 3:1). Google Solar's identified segments can land on any
  // unit within a shared parcel, giving the "panels on my neighbour's
  // roof" complaint. 2D satellite view removes the 3D perspective bias
  // and shows the whole parcel at once — customer sees what's being
  // quoted and book a survey for exact placement.
  //
  // NOTE: earlier revision also flipped to 2D when ALL Google Solar
  // segment centres fell outside the LINZ parcel. Removed: that
  // over-corrected on legitimate 3D-viable addresses (e.g. 31A Hillview
  // Auckland) where Google Solar's segments correctly identify the
  // customer's building even though its centroids sit just outside the
  // parcel polygon (parcel is L-shaped or Google's roof segmentation
  // extends slightly past cadastral boundary — both common). Fix 10a
  // in panelGrid.js already handles the render path safely by skipping
  // polygon-clip when the segment centre is outside the polygon; no
  // reason to also flip render mode.
  const parcelBbox = (() => {
    const ring = buildingLookup.building?.polygon?.[0];
    if (!Array.isArray(ring) || ring.length < 3) return null;
    const lats = ring.map(v => v[1]), lngs = ring.map(v => v[0]);
    const h = (Math.max(...lats) - Math.min(...lats)) * 111320;
    const cosLat = Math.cos((lats[0] || 0) * Math.PI / 180);
    const w = (Math.max(...lngs) - Math.min(...lngs)) * 111320 * cosLat;
    return {
      heightM: h,
      widthM:  w,
      aspect:  Math.max(h, w) / Math.max(0.1, Math.min(h, w)),
    };
  })();
  const parcelIsMultiUnit = parcelBbox && parcelBbox.aspect > 3;

  const segCentresOutsidePolygon = (() => {
    const ring = buildingLookup.building?.polygon?.[0];
    const segs = segments || [];   // locally-populated array from Google Solar / LiDAR
    if (!Array.isArray(ring) || ring.length < 3 || segs.length === 0) return false;
    // Reuse the same ray-cast the parcels module exports.
    const pip = (lat, lng) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
      }
      return inside;
    };
    const insideCount = segs.filter(s => pip(s?.center?.latitude, s?.center?.longitude)).length;
    return insideCount === 0;
  })();

  // P1a (2026-08-31) — 3D-viability check now honours
  // `googleSolarInitiallySucceeded`, not just the final `sourceTag`.
  // Rationale: when Layer 2 fires (Google Solar found the wrong building
  // and we swapped to LiDAR for the right one), Cesium's 3D tiles for
  // this area are still good — Google Solar imagery + Cesium 3D tiles
  // come from the same Google dataset. LiDAR-derived segments (correct
  // building via LINZ parcel) rendered on Cesium's 3D mesh gives
  // customers the 3D roof view they expected, without the "wrong
  // building" bug that Layer 2 was designed to prevent.
  //
  // The `sourceTag === 'live'` OR clause is redundant with the new flag
  // (initialSuccess covers all cases where sourceTag stays 'live') but
  // kept for defensiveness — future edits that mutate sourceTag before
  // this point won't accidentally kill 3D.
  // Owner mandate (2026-08-31): when 3D IS available, panels MUST render
  // correctly on the roof. Don't fall to 2D just because primary-orientation
  // viable capacity is small — instead, include S-facing segments (real
  // installers use S-facing in NZ when it's the only significant roof,
  // just at lower yield). Fix implemented client-side in Cesium3DView.jsx
  // via selectViableSegments retry with `skipSouth: false` when the
  // initial primary-orientation pass yields too little.
  const goodFor3D = (googleSolarInitiallySucceeded || sourceTag === 'live')
                 && buildingLookup.building
                 && buildingLookup.match_type === 'containing'
                 && !parcelIsMultiUnit;
  const renderMode = goodFor3D ? '3d' : '2d';
  const renderModeReason = goodFor3D ? '3d-viable'
    : (!googleSolarInitiallySucceeded && sourceTag !== 'live' ? '2d-google-solar-never-succeeded'
    :  !buildingLookup.building                               ? '2d-no-building'
    :  buildingLookup.match_type !== 'containing'             ? '2d-nearest-only'
    :  parcelIsMultiUnit                                      ? '2d-multi-unit-parcel'
    : '2d-unknown');

  return res.json({
    formattedAddress: geo.formattedAddress,
    coords:           { latitude: geo.latitude, longitude: geo.longitude },
    geocode_quality:  geo.quality,
    solar_source:     solarResp.source,   // 'live' | 'mock'
    used_quality:     usedQuality,
    // Path B (2026-08-26) — '3d' = Cesium Photorealistic; '2d' = aerial
    // satellite + SVG panel overlay. Client renders whichever the server
    // recommends based on data-quality signals.
    render_mode:      renderMode,
    imagery: {
      quality: parsed.imagery_quality,
      date:    parsed.imagery_date,
    },
    roof: {
      max_array_area_m2:               parsed.max_array_area_m2,
      max_array_panels_count:          parsed.max_array_panels_count,
      max_sunshine_hours_per_year:     parsed.max_sunshine_hours_per_year,
      carbon_offset_factor_kg_per_kwh: parsed.carbon_offset_factor_kg_per_kwh,
      // Authoritative building polygon (from OSM/LINZ) — the customer's
      // actual house, drawn on top of the aerial in the client so they can
      // see we've locked onto the right roof.
      building: buildingLookup.building ? {
        source:     buildingLookup.source,          // 'osm' | 'linz'
        match_type: buildingLookup.match_type,      // 'containing' | 'nearest'
        id:         buildingLookup.building.id,
        centroid:   buildingLookup.building.centroid,
        polygon:    buildingLookup.building.polygon, // [ring[], ring[], ...] in [lng, lat]
        area_m2:    buildingLookup.building.area_m2,
        distance_m: buildingLookup.building.distance_m,
      } : null,
      building_lookup_attempts:         buildingLookup.tried,   // diagnostic
      google_center:                    googleCenter,
      google_vs_building_shift_m:       googleVsBuildingShiftM, // >30m = mismatch
      places_vs_parcel_shift_m:         placesVsParcelShiftM,   // Layer 1 pin-drag gating
      placement_confidence:             placementConfidence,    // 'high' | 'medium' | 'low' | 'unknown'
      solar_lookup_coord:               solarLookupCoord,       // what we sent to Google Solar
      authoritative_center:             authoritativeCenter,    // what the aerial + overlay use
      segments,   // full array so the client can render per-face stats later
      // Google's suggested-layout panel positions — used to draw panels on the
      // aerial in Slice 4. Each panel has {center: {latitude, longitude},
      // orientation: 'LANDSCAPE'|'PORTRAIT', yearlyEnergyDcKwh, segmentIndex}.
      solar_panels: solarResp.data?.solarPotential?.solarPanels || [],
      // Physical dimensions Google assumed when computing yearlyEnergyDcKwh —
      // needed to size the SVG rectangles on the overlay so they match reality.
      panel_config: solarResp.data?.solarPotential?.panelHeightMeters != null ? {
        height_m:   solarResp.data.solarPotential.panelHeightMeters,
        width_m:    solarResp.data.solarPotential.panelWidthMeters,
        capacity_w: solarResp.data.solarPotential.panelCapacityWatts,
      } : null,
      // LiDAR-fallback diagnostics (null when Google Solar succeeded).
      // Includes STAC lookup URL, point counts, RANSAC plane count, timings.
      lidar_diagnostics: lidarDiagnostics,
      // Round 4 (2026-08-26) — Bug 7/8. Consolidated diagnostic block so
      // the UI can render a single "what happened" panel in the error
      // card (and, optionally, a debug section on success). Aggregates
      // the shape-of-failure across all upstream stages so QA can tell
      // building-match vs LiDAR-gate vs mesh-sample failures apart
      // without needing to spelunk Render logs.
      roof_analysis_diagnostics: {
        source_pipeline:            sourceTag,               // 'google' | 'lidar' | 'mock'
        fallback_reason:            fallbackReason,          // 'no_verified_building' | ...
        used_quality:               usedQuality || null,     // Google Solar quality tier
        building_source:            buildingLookup.source,   // 'osm' | 'linz' | 'linz-parcel' | null
        building_match_type:        buildingLookup.match_type,
        building_distance_m:        buildingLookup.building?.distance_m ?? null,
        building_match_max_dist_m:  buildingLookup.max_dist_m_used ?? null,
        building_candidates: (buildingLookup.tried || []).reduce(
          (acc, t) => { acc[t.source] = t.count; return acc; }, {}),
        google_vs_building_shift_m: googleVsBuildingShiftM,
        segments_detected:          segments.length,
        // Render-mode decision trace (Option 3 / 2026-08-27)
        render_mode:                renderMode,
        render_mode_reason:         renderModeReason,
        parcel_bbox:                parcelBbox,              // {heightM, widthM, aspect}
        parcel_is_multi_unit:       parcelIsMultiUnit,       // aspect > 3
        seg_centres_outside_parcel: segCentresOutsidePolygon,
        // LiDAR-only sub-block (null on Google path)
        lidar: lidarDiagnostics,
        pvgis: pvgisDiagnostics,
      },
      // Which data source we actually used + why we made that choice.
      // 'google' | 'lidar' | 'mock', plus the fallback trigger reason.
      source: sourceTag,
      fallback_reason: fallbackReason,
      // Week-7 per-address annual yield in kWh/kWp.
      //   Phase 1 (source: 'google_sunshine_quantiles') — area-weighted median
      //     across viable segments' Google Solar sunshineQuantiles[]
      //   Phase 2 (source: 'pvgis')                     — area-weighted mean
      //     across per-segment PVGIS PVcalc calls for LiDAR-only addresses
      // When null, downstream design.compose falls back to REGIONS[postcode]
      // (Auckland Vector 1250 kWh/kWp/yr etc.).
      system_yield: systemYield,           // { kwh_per_kwp_per_year, source, contributing_segments } | null
      pvgis_diagnostics: pvgisDiagnostics, // { attempted, succeeded, failed, cacheHits, ... } | null
    },
    aerial: {
      source:   'google_static_maps',
      url:      aerialUrl,        // wide view — for "is this your house?" confirmation
      tight_url: aerialTightUrl,  // tight view — for panel overlay on quote screen
      zoom:     aerialZoom,
      tight_zoom: aerialTightZoom,
      size:     aerialSize,
    },
  });
}

// ── Parcel lookup (Layer 1 / 2026-08-27) ──────────────────────────────────
// GET /api/roof/parcel-check?lat=&lng=
//
// Lightweight, cache-friendly lookup used by the Step 2 pin-drag UI to
// decide whether to gate the "Confirm this is my house" button. Returns:
//   {
//     places_lat, places_lng,          — echo of query
//     parcel: null | {                 — LINZ Parcels layer 50823
//       polygon,                       — [[[lng,lat],...]] rings
//       centroid: {lat, lng},
//       area_m2,
//     },
//     offset_m: number|null,           — metres from query point to parcel centroid
//     confidence: 'high'|'medium'|'low'|'unknown',
//     contains_query: bool,            — is the query point INSIDE the parcel?
//   }
// Called on: initial pin drop, every pin drag, every map click.
// No Google Solar quota consumed. LINZ Parcels only.
router.get('/parcel-check', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'lat, lng required' });
  }
  try {
    const r = await queryParcelsNear({ latitude: lat, longitude: lng, radiusMeters: 30 });
    if (!r.ok) return res.status(r.status || 502).json({ error: r.error });
    const containing = parcelContaining(r.parcels, lat, lng);
    const picked = containing || nearestParcel(r.parcels);
    if (!picked) {
      return res.json({
        places_lat: lat, places_lng: lng,
        parcel: null,
        offset_m: null,
        confidence: 'unknown',
        contains_query: false,
      });
    }
    const dLat = (lat - picked.centroid.latitude) * 111320;
    const dLng = (lng - picked.centroid.longitude) * 111320 * Math.cos(lat * Math.PI / 180);
    const offsetM = Math.round(Math.sqrt(dLat * dLat + dLng * dLng));
    const containsQuery = !!containing;
    const confidence = !containsQuery ? 'low'
                     : offsetM <= 5   ? 'high'
                     : offsetM <= 15  ? 'medium'
                     :                  'low';
    return res.json({
      places_lat: lat, places_lng: lng,
      parcel: {
        polygon:  picked.polygon,
        centroid: picked.centroid,
        area_m2:  picked.area_m2,
      },
      offset_m: offsetM,
      confidence,
      contains_query: containsQuery,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

// ── DEBUG endpoint (Slice 4a) ─────────────────────────────────────────────
// GET /api/poc/roof/linz-buildings?lat=&lng=&radius=
// Returns raw LINZ Building Outlines within a radius. Used to verify our
// LINZ integration returns the customer's actual building before wiring it
// into the main analysis pipeline.
router.get('/linz-buildings', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const radiusMeters = parseFloat(req.query.radius) || 50;
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'lat + lng required (?lat=&lng=)' });
  }
  try {
    const r = await queryBuildingsNear({ latitude: lat, longitude: lng, radiusMeters });
    if (!r.ok) return res.status(r.status || 502).json({ error: r.error });
    const containing = buildingContaining(r.buildings, lat, lng);
    const nearest    = nearestBuilding(r.buildings);
    return res.json({
      query: r.query,
      count: r.buildings.length,
      containing: containing ? {
        id: containing.id, area_m2: Math.round(containing.area_m2),
        distance_m: Math.round(containing.distance_m),
        centroid: containing.centroid, properties: containing.properties,
      } : null,
      nearest: nearest ? {
        id: nearest.id, area_m2: Math.round(nearest.area_m2),
        distance_m: Math.round(nearest.distance_m),
        centroid: nearest.centroid, properties: nearest.properties,
      } : null,
      all_buildings: r.buildings.map(b => ({
        id: b.id, area_m2: Math.round(b.area_m2),
        distance_m: Math.round(b.distance_m),
        centroid: b.centroid,
        polygon_vertex_count: b.polygon?.[0]?.length || 0,
      })),
    });
  } catch (e) {
    console.error('[poc/roof/linz-buildings] threw:', e);
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// GET /api/poc/roof/osm-buildings?lat=&lng=&radius=
// OSM Overpass API — crowdsourced building polygons, no API key needed.
// More current than LINZ in urban/suburban NZ (LINZ is 2017-era for Auckland).
router.get('/osm-buildings', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const radiusMeters = parseFloat(req.query.radius) || 30;
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'lat + lng required (?lat=&lng=)' });
  }
  try {
    const r = await queryOsmBuildingsNear({ latitude: lat, longitude: lng, radiusMeters });
    if (!r.ok) return res.status(r.status || 502).json({ error: r.error });
    const containing = buildingContaining(r.buildings, lat, lng);
    const nearest    = nearestBuilding(r.buildings);
    return res.json({
      query: r.query,
      count: r.buildings.length,
      containing: containing ? {
        id: containing.id, area_m2: Math.round(containing.area_m2),
        distance_m: Math.round(containing.distance_m),
        centroid: containing.centroid, properties: containing.properties,
      } : null,
      nearest: nearest ? {
        id: nearest.id, area_m2: Math.round(nearest.area_m2),
        distance_m: Math.round(nearest.distance_m),
        centroid: nearest.centroid, properties: nearest.properties,
      } : null,
      all_buildings: r.buildings.map(b => ({
        id: b.id, area_m2: Math.round(b.area_m2),
        distance_m: Math.round(b.distance_m),
        centroid: b.centroid,
        polygon_vertex_count: b.polygon?.[0]?.length || 0,
        properties: b.properties,
      })),
    });
  } catch (e) {
    console.error('[poc/roof/osm-buildings] threw:', e);
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// ── Separate router for aerial proxies (Google Static Maps + LINZ tiles) ────
export const aerialRouter = Router();

// Cross-Origin-Resource-Policy override (2026-09-01) — aerial images are
// embedded via <img src> from the frontend which lives on a different
// origin (e.g. vercel.app while the API is on onrender.com). Helmet's
// default CORP=same-origin causes the browser to SILENTLY block the
// image from rendering even though the fetch itself succeeds — no
// visible error in the network tab, image tile shows up blank. Override
// to 'cross-origin' just for the aerial responses so cross-origin
// embedding is allowed. Does not weaken any other endpoint's security.
aerialRouter.use((req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

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

// GET /api/poc/aerial/streetview?lat=&lng=&size=&pitch=&heading=&fov=
// Proxies Google Streetview Static API. Used on the roof-material picker
// to give the customer a ground-level view of their roof (top-down aerials
// hide corrugation lines / tile ridges that make Metal-vs-Tile obvious).
// No AI — just a visual aid; picker below is the source of truth.
aerialRouter.get('/streetview', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const size    = /^[0-9]{2,4}x[0-9]{2,4}$/.test(req.query.size || '') ? req.query.size : '640x480';
  const fov     = clamp(parseInt(req.query.fov, 10)     || 90, 10, 120);
  const heading = req.query.heading != null ? clamp(parseInt(req.query.heading, 10), 0, 359) : null;
  const pitch   = clamp(parseInt(req.query.pitch, 10)   || 10, -90, 90);
  if (Number.isNaN(lat) || lat < -90 || lat > 90 || Number.isNaN(lng) || lng < -180 || lng > 180) {
    return res.status(400).json({ error: `Bad lat/lng: ${req.query.lat}, ${req.query.lng}` });
  }

  const key = env.googleSolar.apiKey;
  if (!key) {
    return res.status(503).json({
      error: 'GOOGLE_SOLAR_API_KEY not set — cannot fetch Streetview. Reuses the Solar key; enable "Street View Static API" for it in the Google Cloud Console.',
    });
  }

  // If no explicit heading was requested, aim the camera AT the customer's
  // address. Google Streetview's default heading is "whatever direction the
  // Street View car was pointing when it captured the nearest pano" — which
  // for set-back NZ houses often points at the road, past the house, or at
  // the intersection instead of the customer's roof.
  //
  // Fix: hit the Streetview Metadata API to find the actual pano's
  // lat/lng, then compute the compass bearing from pano → address and use
  // that as the heading param. This forces the camera to look at the
  // customer's property regardless of which way the Street View car was
  // driving. Metadata API is FREE (no billing), so the extra call is safe.
  let derivedHeading = null;
  if (heading == null) {
    try {
      const metaUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${key}`;
      const metaResp = await fetch(metaUrl);
      if (metaResp.ok) {
        const meta = await metaResp.json();
        if (meta?.status === 'OK'
            && Number.isFinite(meta?.location?.lat)
            && Number.isFinite(meta?.location?.lng)) {
          derivedHeading = bearingDeg(
            meta.location.lat, meta.location.lng,   // FROM: pano
            lat, lng,                                // TO: address
          );
        }
      }
    } catch { /* fall through — Streetview will pick its default heading */ }
  }

  const params = new URLSearchParams({
    location: `${lat},${lng}`,
    size,
    fov:   String(fov),
    pitch: String(pitch),
    key,
    return_error_code: 'true',   // return 404 on no-imagery instead of a "not available" placeholder image
  });
  const effectiveHeading = heading != null ? heading : derivedHeading;
  if (effectiveHeading != null) params.set('heading', String(Math.round(effectiveHeading)));
  const url = `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return res.status(resp.status).json({
        error: `Google Streetview returned ${resp.status}: ${body.slice(0, 300)}`,
      });
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    res.setHeader('Content-Type',  resp.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.end(buf);
  } catch (e) {
    return res.status(500).json({ error: `Streetview proxy threw: ${e.message}` });
  }
});
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

// Compass bearing from (lat1, lng1) → (lat2, lng2) in degrees [0, 360).
// Standard great-circle formula. 0° = north, 90° = east.
function bearingDeg(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

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
