// ────────────────────────────────────────────────────────────────────────────
// PM Tool — designs API client (Phase 3a — panel-layout design tool)
//
// Wraps GET / PUT /api/pm/quotes/:id/design. Optimistic concurrency:
// caller sends the version they loaded; server rejects stale saves with 409.
//
// Phase 3a state shape (jsonb blob):
//   {
//     view: { zoom: 1.0, panX: 0, panY: 0 },           // Fabric viewport
//     canvas: { serialized: "<Fabric JSON>" | null },  // full canvas state
//   }
//
// Phase 3b+ will add: roof_faces, panels, inverter, battery, string_layout.
// Server intentionally does not validate the shape (jsonb is loose); client
// consumers should tolerate missing fields defensively.
// ────────────────────────────────────────────────────────────────────────────

import api from '../../services/api';

export const pmDesignsAPI = {
  // GET → 200 { id, quote_id, state, version, created_at, updated_at, ... }
  //     → 204 if no design exists yet (client should synthesise a v0 blank)
  //     → 404 if the quote itself doesn't exist
  get: (quoteId) =>
    api.get(`/pm/quotes/${quoteId}/design`, {
      validateStatus: s => s === 200 || s === 204 || s === 404,
    }),

  // PUT → 200/201 { ...design row } on success (version bumped)
  //     → 409 { error, server_version, client_version } on stale save
  //     → 404 if quote doesn't exist
  //     → 400 if state/version malformed
  //
  // Callers MUST send the version they loaded; on 409, reload and merge
  // rather than blindly retry (which would clobber the other editor's work).
  save: (quoteId, { state, version }) =>
    api.put(`/pm/quotes/${quoteId}/design`, { state, version }),

  // POST → 200 { updated:true, tile_radius_m, storage_path } when a tighter
  //          tile was fetched (upgrades a pre-Migration-040 row in place)
  //      → 204 when the analysis is already at a tight radius (≤20m) — no
  //          quota was consumed
  //      → 404 if the quote / contact / analysis doesn't exist
  //      → 429 if Google Solar monthly quota is exhausted
  //
  // Client should call this once on load when the returned roof analysis has
  // tile_radius_m == null OR > 20. Non-blocking — if it fails, we show the
  // wider tile with client-side auto-zoom as fallback.
  refetchRoofImage: (quoteId) =>
    api.post(`/pm/quotes/${quoteId}/refetch-roof-image`, {}, {
      validateStatus: s => s === 200 || s === 204 || s === 404 || s === 409 || s === 429 || s === 502,
    }),
};

// ── Local helpers (no HTTP) ────────────────────────────────────────────────
// The design state schema + manipulation helpers live in ../utils/designState.
// We re-export emptyDesignState here so existing imports keep working. Any
// caller that needs the full schema (roof faces, panels, arrays, migrations)
// should import directly from ../utils/designState.
export { emptyDesignState, migrateDesignState, SCHEMA_VERSION } from '../utils/designState';
