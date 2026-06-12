import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { bootstrapFieldLimits } from './utils/fieldHints';

import PmLayout from './PmLayout';
import OwnerDashboardPage from './pages/OwnerDashboardPage';
import ProjectListPage from './pages/ProjectListPage';
import ProjectNewPage from './pages/ProjectNewPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import AdminPage from './pages/AdminPage';
import QrCodesPage from './pages/QrCodesPage';
import QuoteListPage from './pages/QuoteListPage';
import QuoteNewPage from './pages/QuoteNewPage';
import QuoteFormPage from './pages/QuoteFormPage';
import QuoteDetailPage from './pages/QuoteDetailPage';
import QuoteBillAnalysisPage from './pages/QuoteBillAnalysisPage';

function PmProtected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" /></div>;
  return user ? children : <Navigate to="/login" />;
}

// Sub-router for the PM tool. All routes here render under <PmLayout />.
// Mounted at /pm in the main App.jsx with React.lazy code-splitting so the
// PM tool bundle never loads on the existing portal/website pages.
export default function PmApp() {
  // Boot-time fetch of admin-tunable field_limits (Session B). Fire-and-
  // forget — hints fall back to STATIC_DEFAULTS until this resolves.
  useEffect(() => { bootstrapFieldLimits(api); }, []);

  return (
    <Routes>
      <Route element={<PmProtected><PmLayout /></PmProtected>}>
        <Route index element={<OwnerDashboardPage />} />
        <Route path="owner" element={<OwnerDashboardPage />} />
        <Route path="projects" element={<ProjectListPage />} />
        <Route path="projects/new" element={<ProjectNewPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="quotes" element={<QuoteListPage />} />
        <Route path="quotes/new" element={<QuoteNewPage />} />
        <Route path="quotes/:id" element={<QuoteDetailPage />} />
        <Route path="quotes/:id/edit" element={<QuoteFormPage />} />
        <Route path="quotes/:id/bill-analysis" element={<QuoteBillAnalysisPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="admin/qr-codes" element={<QrCodesPage />} />
      </Route>
    </Routes>
  );
}
