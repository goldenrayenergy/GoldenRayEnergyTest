// ────────────────────────────────────────────────────────────────────────────
// PM Tool — API client
//
// Reuses the existing `api` axios instance (auth token + baseURL handling).
// All endpoints under /pm namespace.
// ────────────────────────────────────────────────────────────────────────────

import api from '../../services/api';

export const pmProjectsAPI = {
  list:        (params) => api.get('/pm/projects', { params }),
  get:         (id)     => api.get(`/pm/projects/${id}`),
  create:      (data)   => api.post('/pm/projects', data),
  update:      (id, data) => api.patch(`/pm/projects/${id}`, data),
  cancel:      (id, reason) => api.delete(`/pm/projects/${id}`, { data: { reason } }),
  updateLane:  (id, lane, body) => api.patch(`/pm/projects/${id}/lanes/${lane}`, body),
};

export const pmArtifactsAPI = {
  list: (projectId, params) => api.get(`/pm/projects/${projectId}/artifacts`, { params }),

  // Upload a file. `data` is a FormData with: file, swim_lane, artifact_type, item_key, notes
  upload: (projectId, formData) =>
    api.post(`/pm/projects/${projectId}/artifacts`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  // Get a 1h signed URL for downloading an artifact file
  signedUrl: (projectId, artifactId) =>
    api.get(`/pm/projects/${projectId}/artifacts/${artifactId}/url`),

  remove: (projectId, artifactId) =>
    api.delete(`/pm/projects/${projectId}/artifacts/${artifactId}`),
};

export const pmEventsAPI = {
  list: (projectId, params) => api.get(`/pm/projects/${projectId}/events`, { params }),
};

export const pmCommentsAPI = {
  list:    (projectId, params) => api.get(`/pm/projects/${projectId}/comments`, { params }),
  create:  (projectId, body)   => api.post(`/pm/projects/${projectId}/comments`, body),
  remove:  (projectId, commentId) => api.delete(`/pm/projects/${projectId}/comments/${commentId}`),
};

export const pmCommissionAPI = {
  commission: (projectId, fields) => api.post(`/pm/projects/${projectId}/commission`, { fields }),
  vppCatalog: () => api.get('/pm/projects/_/vpp-catalog'),
};

export const pmOwnerAPI = {
  dashboard: () => api.get('/pm/owner/dashboard'),
};

export const pmAdminAPI = {
  // company settings (single row)
  getSettings:    () => api.get('/pm/admin/settings'),
  updateSettings: (patch) => api.patch('/pm/admin/settings', patch),

  // financing options
  listFinancing:    () => api.get('/pm/admin/financing'),
  createFinancing:  (data) => api.post('/pm/admin/financing', data),
  updateFinancing:  (id, patch) => api.patch(`/pm/admin/financing/${id}`, patch),
  deleteFinancing:  (id) => api.delete(`/pm/admin/financing/${id}`),

  // proposal_terms (versioned)
  listTerms:    () => api.get('/pm/admin/terms'),
  currentTerms: () => api.get('/pm/admin/terms/current'),
  createTerms:  (data) => api.post('/pm/admin/terms', data),

  // Supplier data importer — accepts the Goldenray_Supplier_Setup.xlsx file
  importSupplierData: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/pm/admin/import/supplier-data', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  // labour_rates — install / commissioning / compliance / design line items
  // added to package pricing automatically by the proposal generator
  listLabourRates:   () => api.get('/pm/admin/labour-rates'),
  matchLabourRates:  (systemKw, hasBattery) =>
    api.get(`/pm/admin/labour-rates/match?system_kw=${systemKw}&has_battery=${hasBattery}`),
  createLabourRate:  (data) => api.post('/pm/admin/labour-rates', data),
  updateLabourRate:  (id, patch) => api.patch(`/pm/admin/labour-rates/${id}`, patch),
  deleteLabourRate:  (id) => api.delete(`/pm/admin/labour-rates/${id}`),

  // P8 — Catalogue CSV import (labour + compliance rate-cards)
  importCatalogueCsv: (kind, file, reason) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('reason', reason);
    return api.post(`/pm/admin/catalogue/import/${kind}`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  listCatalogueImports: (target, limit = 20) =>
    api.get(`/pm/admin/catalogue/imports${target ? `?target=${target}&limit=${limit}` : `?limit=${limit}`}`),
  catalogueTemplateUrl: (kind) => `/pm/admin/catalogue/template/${kind}`,

  // P8.5 — Per-row CRUD for the rate-cards (Labour & Compliance tab)
  listRateCard:        (kind)         => api.get(`/pm/admin/catalogue/${kind}`),
  createRateCardRow:   (kind, row)    => api.post(`/pm/admin/catalogue/${kind}`, row),
  updateRateCardRow:   (kind, sku, patch) => api.patch(`/pm/admin/catalogue/${kind}/${encodeURIComponent(sku)}`, patch),
  deactivateRateCardRow: (kind, sku, reason) =>
    api.delete(`/pm/admin/catalogue/${kind}/${encodeURIComponent(sku)}`, { data: { reason } }),

  // Session B — field_limits (admin-tunable validator/hint ranges).
  // path is a JSON-ish dotted spec path (e.g. 'system.panel.count') — encode
  // for the URL since some paths contain brackets in their string form.
  listFieldLimits:        () => api.get('/pm/admin/field-limits'),
  listFieldLimitsAudit:   (path, limit = 100) =>
    api.get(`/pm/admin/field-limits/audit`,
      { params: path ? { path, limit } : { limit } }),
  updateFieldLimit:       (path, body) =>
    api.patch(`/pm/admin/field-limits/${encodeURIComponent(path)}`, body),
};

// QR-code campaign management (Phase D)
export const pmQrCodesAPI = {
  list:    () => api.get('/pm/admin/qr-codes'),
  create:  (data)       => api.post('/pm/admin/qr-codes', data),
  update:  (id, patch)  => api.patch(`/pm/admin/qr-codes/${id}`, patch),

  // Download QR as PNG or SVG. Uses axios (auth token attaches) + blob, then
  // triggers a client-side download. baseUrl is what the QR will encode —
  // omit to use the server's QR_BASE_URL env (or its own host as fallback).
  download: async (slug, format = 'png', baseUrl = null) => {
    const params = baseUrl ? { baseUrl } : {};
    const r = await api.get(`/pm/admin/qr-codes/${slug}/${format}`, { params, responseType: 'blob' });
    const blob = new Blob([r.data], { type: format === 'png' ? 'image/png' : 'image/svg+xml' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `goldenray-qr-${slug}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};
