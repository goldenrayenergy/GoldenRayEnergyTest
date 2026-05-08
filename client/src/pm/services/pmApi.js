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
