// ────────────────────────────────────────────────────────────────────────────
// Admin — Address polygon overrides
//
// Layer 3 (Session 2, 2026-08-28). Owner-facing tool for the ~16% of NZ
// addresses where Google Solar + LINZ Parcels + OSM + LINZ Buildings all
// identify the wrong roof. Owner draws the correct polygon on aerial and
// the roof-analysis pipeline uses THAT going forward.
//
// One page, two views:
//   • LIST — searchable list of active + deactivated overrides, click to edit
//   • EDITOR — Leaflet map with LINZ satellite tiles + manual polygon drawing
//
// Auth: admin role required for all writes. Reuses existing JWT auth via
// api service. Read requires authenticated staff (via RLS + server route).
// ────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../../services/api';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';

// Default marker icon fix — Leaflet's built-in requires paths relative
// to the CSS, which Vite bundling breaks. Inline SVG data-URL keeps
// everything self-contained.
const VERTEX_ICON = L.divIcon({
  html: '<div style="width:14px;height:14px;background:#D9531E;border:2px solid white;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.4);"></div>',
  className: 'vertex-marker',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const ESRI_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTRIBUTION = 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics';

export default function PolygonOverridesPage() {
  const [view, setView] = useState('list');    // 'list' | 'edit' | 'new'
  const [editingId, setEditingId] = useState(null);
  const [overrides, setOverrides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDeactivated, setShowDeactivated] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const url = showDeactivated ? '/pm/admin/polygon-overrides?all=1' : '/pm/admin/polygon-overrides';
      const { data } = await api.get(url);
      setOverrides(data.overrides || []);
    } catch (e) {
      console.error('[PolygonOverrides] load failed:', e);
      alert('Failed to load overrides: ' + (e.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  }, [showDeactivated]);

  useEffect(() => { loadList(); }, [loadList]);

  if (view === 'edit' || view === 'new') {
    return (
      <OverrideEditor
        overrideId={view === 'edit' ? editingId : null}
        onBack={() => { setView('list'); setEditingId(null); loadList(); }}
      />
    );
  }

  return (
    <div className="animate-fade-in space-y-4">
      <Card
        title="Polygon overrides"
        subtitle="Manual per-address roof polygons for cases where automated detection fails"
        action={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <input
                type="checkbox"
                checked={showDeactivated}
                onChange={(e) => setShowDeactivated(e.target.checked)}
              />
              Show deactivated
            </label>
            <Button size="sm" onClick={() => { setEditingId(null); setView('new'); }}>
              + Add override
            </Button>
          </div>
        }
      >
        {loading ? (
          <div className="py-8 text-center text-sm text-gray-400">Loading…</div>
        ) : overrides.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No overrides yet. Click <strong>+ Add override</strong> to create one for a
            problem address.
          </div>
        ) : (
          <div className="space-y-2">
            {overrides.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => { setEditingId(o.id); setView('edit'); }}
                className={`w-full text-left flex items-start gap-3 p-3 border rounded-lg transition
                  ${o.is_active
                    ? 'border-gray-200 dark:border-gray-800 hover:border-amber-400 hover:bg-amber-50/30 dark:hover:bg-amber-950/20'
                    : 'border-gray-100 dark:border-gray-900 bg-gray-50/50 dark:bg-gray-900/50 opacity-70'}
                `}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <div className="text-sm font-semibold text-[#1A1614] dark:text-white truncate">
                      {o.address_snapshot}
                    </div>
                    {!o.is_active && <Badge color="#888">deactivated</Badge>}
                    <Badge color={o.draw_source === 'linz_parcel' ? '#0369A1' : '#7C2D12'}>
                      {o.draw_source === 'linz_parcel' ? 'from LINZ' : 'drawn fresh'}
                    </Badge>
                    {o.segments_override && <Badge color="#B45309">+ segments</Badge>}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">
                    {Number(o.latitude).toFixed(6)}, {Number(o.longitude).toFixed(6)}
                    {' · '}
                    {o.polygon?.[0]?.length ?? 0} vertices
                    {' · '}
                    {new Date(o.created_at).toLocaleDateString('en-NZ')}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                    {o.notes}
                  </div>
                  {!o.is_active && o.deactivated_reason && (
                    <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-1 italic">
                      Deactivated: {o.deactivated_reason}
                    </div>
                  )}
                </div>
                <div className="text-xs text-gray-400 self-center">edit →</div>
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// EDITOR — Leaflet map with click-to-add-vertex + drag-to-move.
// ────────────────────────────────────────────────────────────────────────────
function OverrideEditor({ overrideId, onBack }) {
  const isEdit = !!overrideId;
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Form state — mirrors DB columns
  const [addressInput, setAddressInput] = useState('');   // for NEW: address search box
  const [addressSnapshot, setAddressSnapshot] = useState('');
  const [latitude, setLatitude] = useState(null);
  const [longitude, setLongitude] = useState(null);
  const [ring, setRing] = useState([]);   // [[lng, lat], ...]  — polygon vertices
  const [drawSource, setDrawSource] = useState('blank');   // 'linz_parcel' | 'blank'
  const [notes, setNotes] = useState('');
  const [parcelRingFromLinz, setParcelRingFromLinz] = useState(null);   // available after address confirm

  // Leaflet refs
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const vertexMarkersRef = useRef([]);    // Leaflet marker instances, index-aligned to ring
  const polylineRef = useRef(null);       // Closed polyline visualising the ring

  // ── Load existing override for edit ────────────────────────────────────
  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const { data } = await api.get(`/pm/admin/polygon-overrides/${overrideId}`);
        setAddressSnapshot(data.address_snapshot);
        setAddressInput(data.address_snapshot);
        setLatitude(Number(data.latitude));
        setLongitude(Number(data.longitude));
        setRing(data.polygon?.[0] || []);
        setDrawSource(data.draw_source);
        setNotes(data.notes);
      } catch (e) {
        setError('Failed to load override: ' + (e.response?.data?.error || e.message));
      } finally {
        setLoading(false);
      }
    })();
  }, [isEdit, overrideId]);

  // ── Init the Leaflet map (once we have coords) ─────────────────────────
  useEffect(() => {
    if (latitude == null || longitude == null) return;
    if (mapRef.current) return;   // already initialised
    if (!mapContainerRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [latitude, longitude],
      zoom: 20,
      maxZoom: 22,
      zoomControl: true,
    });
    L.tileLayer(ESRI_TILES, {
      attribution: ESRI_ATTRIBUTION,
      maxZoom: 22,
      maxNativeZoom: 19,
    }).addTo(map);

    // Click on map (not on an existing vertex marker) → add a new vertex
    // at that lat/lng. Uses functional setState so we don't need the
    // current `ring` value in this effect's deps.
    map.on('click', (e) => {
      setRing((prev) => [...prev, [e.latlng.lng, e.latlng.lat]]);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [latitude, longitude]);

  // ── Redraw vertex markers + polygon line whenever `ring` changes ───────
  useEffect(() => {
    if (!mapRef.current) return;
    // Clear old markers + polyline
    vertexMarkersRef.current.forEach((m) => m.remove());
    vertexMarkersRef.current = [];
    if (polylineRef.current) { polylineRef.current.remove(); polylineRef.current = null; }

    // Draw new vertex markers — each draggable, click-to-delete
    ring.forEach(([lng, lat], idx) => {
      const marker = L.marker([lat, lng], { icon: VERTEX_ICON, draggable: true }).addTo(mapRef.current);
      marker.on('dragend', () => {
        const { lat: newLat, lng: newLng } = marker.getLatLng();
        setRing((prev) => prev.map((pt, i) => (i === idx ? [newLng, newLat] : pt)));
      });
      marker.on('click', () => {
        // Delete this vertex (min 3 to remain valid — else keep it)
        setRing((prev) => (prev.length > 3 ? prev.filter((_, i) => i !== idx) : prev));
      });
      marker.bindTooltip(`Vertex ${idx + 1} — drag to move, click to delete`, {
        direction: 'top', offset: [0, -10],
      });
      vertexMarkersRef.current.push(marker);
    });

    // Draw the closed polygon line
    if (ring.length >= 2) {
      const latLngs = ring.map(([lng, lat]) => [lat, lng]);
      polylineRef.current = L.polygon(latLngs, {
        color: '#D9531E',
        weight: 3,
        fillColor: '#D9531E',
        fillOpacity: 0.12,
        interactive: false,   // clicks pass through to map (so we can add vertices inside)
      }).addTo(mapRef.current);
    }
  }, [ring]);

  // ── Search for address (used in NEW mode) ──────────────────────────────
  async function searchAddress() {
    if (!addressInput.trim()) return;
    setError(null);
    try {
      // Use existing Places autocomplete API — take first suggestion.
      const { data: aut } = await api.get(
        `/places/autocomplete?input=${encodeURIComponent(addressInput.trim())}`
      );
      if (!aut.predictions?.length) {
        setError('No address suggestions found. Try refining the search.');
        return;
      }
      const first = aut.predictions[0];
      // Fetch details to get lat/lng
      const { data: det } = await api.get(
        `/places/details?placeId=${first.place_id}`
      );
      const lat = det.geometry?.location?.lat;
      const lng = det.geometry?.location?.lng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        setError('Address found but no coordinates returned.');
        return;
      }
      setLatitude(lat);
      setLongitude(lng);
      setAddressSnapshot(det.formatted_address || first.description);
      // Also fetch the LINZ parcel so admin can use it as a starting point
      try {
        const { data: parcel } = await api.get(
          `/roof/parcel-check?lat=${lat}&lng=${lng}`
        );
        if (parcel?.parcel?.polygon?.[0]) {
          setParcelRingFromLinz(parcel.parcel.polygon[0]);
        }
      } catch (parcelErr) {
        // Non-fatal — admin can still draw fresh
        console.warn('[PolygonOverrides] parcel-check failed (non-fatal):', parcelErr.message);
      }
    } catch (e) {
      setError('Address search failed: ' + (e.response?.data?.error || e.message));
    }
  }

  // ── Start polygon from LINZ parcel ─────────────────────────────────────
  function startFromLinz() {
    if (!parcelRingFromLinz) return;
    setRing(parcelRingFromLinz.map(([lng, lat]) => [lng, lat]));   // copy
    setDrawSource('linz_parcel');
    // Fit map to parcel bounds
    if (mapRef.current) {
      const bounds = L.latLngBounds(parcelRingFromLinz.map(([lng, lat]) => [lat, lng]));
      mapRef.current.fitBounds(bounds, { padding: [40, 40] });
    }
  }

  function startBlank() {
    setRing([]);
    setDrawSource('blank');
  }

  // ── Save (create or update) ────────────────────────────────────────────
  async function save() {
    if (ring.length < 3) {
      setError('Polygon needs at least 3 vertices. Click on the map to add vertices.');
      return;
    }
    if (notes.trim().length < 10) {
      setError('Notes must be at least 10 characters — explain WHY this override exists (for the audit trail).');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        latitude,
        longitude,
        address_snapshot: addressSnapshot,
        polygon: ring,      // server accepts raw ring OR wrapped GeoJSON rings
        notes,
        draw_source: drawSource,
      };
      if (isEdit) {
        // PATCH — only send fields that can change
        await api.patch(`/pm/admin/polygon-overrides/${overrideId}`, {
          polygon: ring,
          notes,
        });
      } else {
        await api.post('/pm/admin/polygon-overrides', payload);
      }
      onBack();
    } catch (e) {
      setError('Save failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setSaving(false);
    }
  }

  // ── Deactivate (edit mode only) ────────────────────────────────────────
  async function deactivate() {
    const reason = window.prompt('Why is this override being deactivated? (min 5 chars, required for audit trail)');
    if (!reason || reason.trim().length < 5) return;
    setSaving(true);
    try {
      await api.post(`/pm/admin/polygon-overrides/${overrideId}/deactivate`, { reason });
      onBack();
    } catch (e) {
      setError('Deactivate failed: ' + (e.response?.data?.error || e.message));
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="py-12 text-center text-sm text-gray-400">Loading…</div>;
  }

  return (
    <div className="animate-fade-in">
      <Card
        title={isEdit ? 'Edit override' : 'New override'}
        subtitle={isEdit ? addressSnapshot : 'Find the address, then draw the correct roof polygon'}
        action={
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onBack} disabled={saving}>Cancel</Button>
            {isEdit && (
              <Button variant="ghost" size="sm" onClick={deactivate} disabled={saving}>Deactivate</Button>
            )}
            <Button size="sm" onClick={save} disabled={saving || latitude == null}>
              {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Create override')}
            </Button>
          </div>
        }
      >
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200 dark:border-red-900">
            {error}
          </div>
        )}

        {/* Address search (NEW only, hidden after coords set) */}
        {!isEdit && latitude == null && (
          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Search for address
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchAddress()}
                placeholder="10 Newnham Terrace, Upper Riccarton, Christchurch"
                className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm dark:bg-gray-900 dark:text-white outline-none focus:border-amber-400"
              />
              <Button size="sm" onClick={searchAddress}>Find</Button>
            </div>
          </div>
        )}

        {/* Map + tool row (once coords set) */}
        {latitude != null && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <div className="text-sm">
                <strong className="text-gray-700 dark:text-gray-300">{addressSnapshot}</strong>
                <span className="ml-2 text-[11px] font-mono text-gray-500">
                  {latitude.toFixed(6)}, {longitude.toFixed(6)}
                </span>
              </div>
              <div className="flex-1" />
              <div className="flex items-center gap-2">
                {parcelRingFromLinz && (
                  <Button variant="ghost" size="sm" onClick={startFromLinz}>
                    Start from LINZ parcel
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={startBlank}>
                  Start blank
                </Button>
              </div>
            </div>

            <div
              ref={mapContainerRef}
              className="rounded-xl overflow-hidden border-2 border-gray-200 dark:border-gray-800"
              style={{ height: 480 }}
            />

            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
              <span>· Click map to add a vertex</span>
              <span>· Drag markers to move vertices</span>
              <span>· Click a marker to delete it (min 3 remains)</span>
              <span className="ml-auto font-mono text-[11px]">
                {ring.length} vertices · source: {drawSource}
              </span>
            </div>

            {/* Notes — required, min 10 chars */}
            <div className="mt-4">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Notes (why this override exists)
                <span className="ml-2 text-red-500 normal-case">required · min 10 chars</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="e.g. Customer confirmed roof extends 4m east of OSM outline — new extension not in aerial yet"
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 rounded-lg text-sm dark:bg-gray-900 dark:text-white outline-none focus:border-amber-400 font-sans"
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
