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
