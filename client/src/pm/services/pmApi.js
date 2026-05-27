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
