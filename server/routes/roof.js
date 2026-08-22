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
import { analyseRoofFromLidar }               from '../services/linz/lidarAnalyseRoof.js';
import { getPvgisClient }                     from '../services/pvgis/pvgisClient.js';
import { computePvgisYieldForSegments }       from '../services/pvgis/pvgisSegmentYield.js';

// Try OSM first (crowdsourced, current), fall back to LINZ (2017-era for
// Auckland but authoritative when it has data), then return whichever
// yielded a polygon containing OR nearest to the requested point. Returns
// { building, source, tried: [...] } or { building: null, tried: [...] }.
async function findCustomerBuilding({ latitude, longitude }) {
  const tried = [];

  // 1. OSM primary
  const osm = await queryOsmBuildingsNear({ latitude, longitude, radiusMeters: 40 });
  tried.push({ source: 'osm', ok: osm.ok, count: osm.buildings?.length ?? 0, error: osm.error || null });
  if (osm.ok && osm.buildings.length > 0) {
    const containing = buildingContaining(osm.buildings, latitude, longitude);
    const nearest    = nearestBuilding(osm.buildings);
    // Prefer containing (definitely their house); accept nearest within 30m
    // as a good candidate (Places coords often land in driveway/front-yard).
    // Tightened threshold — anything >15m from the Places-verified rooftop coord
// is almost certainly the WRONG building (stale LINZ 2017 data for new
// subdivisions matches nearby demolished/old structures). Rejecting these
// keeps us honest — we fall back to the Places coord which is the customer's
// actual roof per Google.
const picked = containing || (nearest && nearest.distance_m <= 15 ? nearest : null);
    if (picked) return { building: picked, source: 'osm', match_type: containing ? 'containing' : 'nearest', tried };
  }

  // 2. LINZ fallback
  const linz = await queryBuildingsNear({ latitude, longitude, radiusMeters: 40 });
  tried.push({ source: 'linz', ok: linz.ok, count: linz.buildings?.length ?? 0, error: linz.error || null });
  if (linz.ok && linz.buildings.length > 0) {
    const containing = buildingContaining(linz.buildings, latitude, longitude);
    const nearest    = nearestBuilding(linz.buildings);
    // Tightened threshold — anything >15m from the Places-verified rooftop coord
// is almost certainly the WRONG building (stale LINZ 2017 data for new
// subdivisions matches nearby demolished/old structures). Rejecting these
// keeps us honest — we fall back to the Places coord which is the customer's
// actual roof per Google.
const picked = containing || (nearest && nearest.distance_m <= 15 ? nearest : null);
    if (picked) return { building: picked, source: 'linz', match_type: containing ? 'containing' : 'nearest', tried };
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
  } else {
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
    } else if (fallbackReason === 'no_verified_building') {
      // LiDAR override failed — roll back to Google Solar (stale but present).
      console.log('[poc/roof/analyse] LiDAR override failed, rolling back to Google Solar (stale but present):', lidar.error);
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
      return res.status(404).json({
        error: `No solar imagery from Google AND LiDAR fallback failed: ${lidar.error}`,
        coords: { latitude: geo.latitude, longitude: geo.longitude },
        formattedAddress: geo.formattedAddress,
        building_lookup: buildingLookup,
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
