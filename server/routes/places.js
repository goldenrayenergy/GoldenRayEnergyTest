// POC — Google Places API (New) proxy routes.
//
// Why: relying on the Geocoding API to convert a raw bill-extracted address
// string to lat/lng is unreliable — for new NZ subdivisions the Geocoding
// API often returns an approximate point on the street even when its
// `quality` field says ROOFTOP. Google Maps itself uses the Places API
// (which is what customers see when they search their address), so this
// route makes our POC use the same source of truth.
//
//   GET /api/poc/places/autocomplete?input=X    → suggestions (as user types)
//   GET /api/poc/places/details?placeId=X       → { latitude, longitude, formattedAddress }
//
// Both proxy the new Places API (v1 — https://places.googleapis.com/v1/*).
// Requires "Places API (New)" enabled in Google Cloud Console for the same
// GOOGLE_SOLAR_API_KEY. NZ-biased via regionCode/includedRegionCodes.

import { Router } from 'express';
import env from '../config/env.js';

const router = Router();

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const DETAILS_URL_PREFIX = 'https://places.googleapis.com/v1/places/';

function keyOr503(res) {
  const key = env.googleSolar.apiKey;
  if (!key) {
    res.status(503).json({
      error: 'GOOGLE_SOLAR_API_KEY not set — Places API proxy unavailable. Reuses the Solar key; enable "Places API (New)" for it in Google Cloud Console.',
    });
    return null;
  }
  return key;
}

// ── GET /autocomplete?input=X&sessionToken=Y ─────────────────────────────
// sessionToken is optional but recommended by Google: multiple autocomplete
// calls followed by one details call under the same token are billed as one
// "session" — much cheaper than per-request. Client generates + reuses a
// UUID per address-search session.
router.get('/autocomplete', async (req, res) => {
  const input = (req.query.input || '').toString().trim();
  const sessionToken = (req.query.sessionToken || '').toString().trim();
  if (!input || input.length < 2) {
    return res.json({ suggestions: [] });
  }

  const key = keyOr503(res); if (!key) return;

  try {
    const resp = await fetch(AUTOCOMPLETE_URL, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'X-Goog-Api-Key':    key,
        'X-Goog-FieldMask':  'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat',
      },
      body: JSON.stringify({
        input,
        regionCode: 'nz',
        includedRegionCodes: ['nz'],
        ...(sessionToken ? { sessionToken } : {}),
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return res.status(resp.status).json({
        error: `Places autocomplete returned ${resp.status}: ${body.slice(0, 400)}`,
      });
    }
    const data = await resp.json();
    // Project down to what the client needs
    const suggestions = (data.suggestions || [])
      .map(s => s.placePrediction)
      .filter(Boolean)
      .map(p => ({
        place_id:      p.placeId,
        text:          p.text?.text,
        main_text:     p.structuredFormat?.mainText?.text,
        secondary_text: p.structuredFormat?.secondaryText?.text,
      }));
    return res.json({ suggestions });
  } catch (e) {
    return res.status(500).json({ error: `Places autocomplete threw: ${e.message}` });
  }
});

// ── GET /details?placeId=X&sessionToken=Y ─────────────────────────────────
router.get('/details', async (req, res) => {
  const placeId = (req.query.placeId || '').toString().trim();
  const sessionToken = (req.query.sessionToken || '').toString().trim();
  if (!placeId) {
    return res.status(400).json({ error: 'placeId required' });
  }

  const key = keyOr503(res); if (!key) return;

  const url = new URL(DETAILS_URL_PREFIX + encodeURIComponent(placeId));
  if (sessionToken) url.searchParams.set('sessionToken', sessionToken);

  try {
    const resp = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key':   key,
        'X-Goog-FieldMask': 'id,formattedAddress,location,addressComponents,types',
      },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return res.status(resp.status).json({
        error: `Places details returned ${resp.status}: ${body.slice(0, 400)}`,
      });
    }
    const data = await resp.json();
    return res.json({
      place_id:         data.id,
      formattedAddress: data.formattedAddress,
      latitude:         data.location?.latitude,
      longitude:        data.location?.longitude,
      types:            data.types || [],
      addressComponents: data.addressComponents || [],
    });
  } catch (e) {
    return res.status(500).json({ error: `Places details threw: ${e.message}` });
  }
});

export default router;
