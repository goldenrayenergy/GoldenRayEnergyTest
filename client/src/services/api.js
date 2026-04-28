import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

// Request interceptor — attach token
api.interceptors.request.use(config => {
  const token = localStorage.getItem('gr_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Response interceptor — handle 401
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('gr_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;

// ── Typed API helpers ──
export const leadsAPI = {
  getAll: (params) => api.get('/leads', { params }),
  getById: (id) => api.get(`/leads/${id}`),
  create: (data) => api.post('/leads', data),
  update: (id, data) => api.patch(`/leads/${id}`, data),
  delete: (id) => api.delete(`/leads/${id}`),
  getStats: () => api.get('/leads/stats'),
};

export const dealsAPI = {
  getAll: (params) => api.get('/deals', { params }),
  getById: (id) => api.get(`/deals/${id}`),
  create: (data) => api.post('/deals', data),
  update: (id, data) => api.patch(`/deals/${id}`, data),
  delete: (id) => api.delete(`/deals/${id}`),
  getPipeline: () => api.get('/deals/pipeline'),
  getForecast: () => api.get('/deals/forecast'),
};

export const companiesAPI = {
  getAll: () => api.get('/companies'),
  getById: (id) => api.get(`/companies/${id}`),
  create: (data) => api.post('/companies', data),
  update: (id, data) => api.patch(`/companies/${id}`, data),
};

export const campaignsAPI = {
  getAll: () => api.get('/campaigns'),
  getStats: () => api.get('/campaigns/stats'),
  create: (data) => api.post('/campaigns', data),
  update: (id, data) => api.patch(`/campaigns/${id}`, data),
};

export const tasksAPI = {
  getAll: (params) => api.get('/tasks', { params }),
  create: (data) => api.post('/tasks', data),
  update: (id, data) => api.patch(`/tasks/${id}`, data),
  delete: (id) => api.delete(`/tasks/${id}`),
};

export const activitiesAPI = {
  getAll: (params) => api.get('/activities', { params }),
  create: (data) => api.post('/activities', data),
};

export const reportsAPI = {
  getDashboard: () => api.get('/reports/dashboard'),
  getTeam: () => api.get('/reports/team'),
};

export const proposalsAPI = {
  calculate: (data) => api.post('/proposals/calculate', data),
  generate: (data) => api.post('/proposals/generate', data),
  getPDF: (id) => api.post(`/proposals/${id}/pdf`, {}, { responseType: 'blob' }),
  send: (id) => api.post(`/proposals/${id}/send`),
};

export const configAPI = {
  getSolarPricing: () => api.get('/config/solar-pricing'),
  updateSolarPricing: (data) => api.put('/config/solar-pricing', data),
  getPipelineStages: () => api.get('/config/pipeline-stages'),
};
