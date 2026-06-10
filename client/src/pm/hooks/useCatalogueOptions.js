import { useEffect, useState } from 'react';
import { pmCatalogueAPI } from '../services/pmQuotesApi';

// Module-level cache + in-flight promise — every form mount reuses the same
// fetch instead of hammering the endpoint each time the rep flips tabs.
let _cache = null;
let _inflight = null;

async function loadOnce() {
  if (_cache) return _cache;
  if (_inflight) return _inflight;
  _inflight = pmCatalogueAPI.options()
    .then(r => { _cache = r.data; _inflight = null; return _cache; })
    .catch(e => { _inflight = null; throw e; });
  return _inflight;
}

// Reset (used by admin CSV re-import path later — not wired yet).
export function invalidateCatalogueOptionsCache() {
  _cache = null;
}

// Returns { options, loading, error }.
//   options.panels[], options.inverters[], options.batteries[],
//   options.bms_controllers[], options.smart_meters[], options.ev_chargers[]
// Each entry: { sku, label, brand, ... category-specific fields }.
//
// While loading or on error, returns a safe-shape empty object so consumers
// can fall back to legacy hardcoded REFERENCE without crashing.
export default function useCatalogueOptions() {
  const [options, setOptions] = useState(_cache);
  const [loading, setLoading] = useState(!_cache);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (_cache) {
      setOptions(_cache);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadOnce()
      .then(data => { if (!cancelled) { setOptions(data); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(e); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  return {
    options: options || {
      panels: [], inverters: [], batteries: [],
      bms_controllers: [], smart_meters: [], ev_chargers: [],
    },
    loading,
    error,
  };
}
