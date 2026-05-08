import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import axios from 'axios';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import './index.css';

// Production: API lives on a separate Render host. In dev, leave unset so
// Vite's proxy handles /api/* → localhost:5000. Raw axios calls in pages
// like WebsitePage use relative '/api/...' paths; this default lets those
// resolve against the right backend without rewriting every call site.
const apiBase = import.meta.env.VITE_API_BASE_URL;
if (apiBase) axios.defaults.baseURL = apiBase.replace(/\/+$/, '');

// Theme toggle was removed. Strip any leftover dark-mode state from
// browsers that previously had it set so existing sessions flip back
// to light cleanly without a hard reload.
if (typeof document !== 'undefined') {
  document.documentElement.classList.remove('dark');
  try { localStorage.removeItem('gr_theme'); } catch {}
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
