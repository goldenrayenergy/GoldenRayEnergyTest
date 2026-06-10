// ────────────────────────────────────────────────────────────────────────────
// Cached wrapper around loadCatalogueFromDb.
//
// The DB loader query is ~150ms (one supabase round-trip + a few BoS rows).
// Preview-validate fires every 500ms while the rep types, so without a cache
// we'd hammer Supabase. Cache TTL: 60 seconds. Bust via invalidate() after
// admin CSV import (P8 wires that callsite).
// ────────────────────────────────────────────────────────────────────────────

import { loadCatalogueFromDb } from './dbLoader.js';

const TTL_MS = 60 * 1000;

let _cached = null;
let _cachedAt = 0;
let _inflight = null;

export async function getCachedCatalogue(supabase) {
  const now = Date.now();
  if (_cached && now - _cachedAt < TTL_MS) return _cached;
  if (_inflight) return _inflight;
  _inflight = loadCatalogueFromDb(supabase)
    .then(cat => {
      _cached = cat;
      _cachedAt = now;
      _inflight = null;
      return cat;
    })
    .catch(e => { _inflight = null; throw e; });
  return _inflight;
}

export function invalidateCatalogueCache() {
  _cached = null;
  _cachedAt = 0;
}
