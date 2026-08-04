import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { useAuth } from './context/AuthContext';

// PM Tool (Phase A) — lazy-loaded so it never enters the bundle on portal/website pages.
const PmApp = lazy(() => import('./pm/PmApp'));

// Website pages
import WebsitePage from './pages/WebsitePage';
import FinancePage from './pages/FinancePage';
import LoginPage from './pages/LoginPage';
import SolarPackagesPage from './pages/SolarPackagesPage';
import SolarPackageDetailPage from './pages/SolarPackageDetailPage';
import ShopPage from './pages/ShopPage';
import ShopProductDetailPage from './pages/ShopProductDetailPage';
import BillAnalysisPage from './pages/BillAnalysisPage';
import GetQuotePage from './pages/GetQuotePage';
import PublicProposalPage from './pages/PublicProposalPage';

// POC — new public quote flow spike; unlinked from anywhere, reachable only
// by direct URL. Lazy-loaded so it doesn't add weight to the main bundle.
const PocQuotePage = lazy(() => import('./pages/poc/QuotePage'));

// Portal pages
import PortalLayout from './components/layout/PortalLayout';
import DashboardPage from './pages/portal/DashboardPage';
import DealsPage from './pages/portal/DealsPage';
import SalesPage from './pages/portal/SalesPage';
import TasksPage from './pages/portal/TasksPage';
import PipelinePage from './pages/portal/PipelinePage';
import CampaignsPage from './pages/portal/CampaignsPage';
import EmailAnalyticsPage from './pages/portal/EmailAnalyticsPage';
import LeadScoringPage from './pages/portal/LeadScoringPage';
import ContactsPage from './pages/portal/ContactsPage';
import CompaniesPage from './pages/portal/CompaniesPage';
import ReportsPage from './pages/portal/ReportsPage';
import AdminPage from './pages/portal/AdminPage';
import EnquiriesPage from './pages/portal/EnquiriesPage';
import EnquiryDetailPage from './pages/portal/EnquiryDetailPage';
import ProjectsPage from './pages/portal/ProjectsPage';
import ProjectDetailPage from './pages/portal/ProjectDetailPage';
import FinanceApplicationsPage from './pages/portal/FinanceApplicationsPage';
import OverrideRequestsPage from './pages/portal/OverrideRequestsPage';
import ProductsPage from './pages/portal/ProductsPage';
import PackagesPage from './pages/portal/PackagesPage';
import TradeRequestsPage from './pages/portal/TradeRequestsPage';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" /></div>;
  return user ? children : <Navigate to="/login" />;
}

function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" /></div>;
  if (!user) return <Navigate to="/login" />;
  if (user.role !== 'admin') return <Navigate to="/portal" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<WebsitePage />} />
      <Route path="/finance" element={<AdminRoute><FinancePage /></AdminRoute>} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/solar-packages" element={<SolarPackagesPage />} />
      <Route path="/solar-packages/:slug" element={<SolarPackageDetailPage />} />
      <Route path="/shop" element={<ShopPage />} />
      <Route path="/shop/:sku" element={<ShopProductDetailPage />} />
      {/* Option 6.5: /bill-analysis now redirects into the wizard's bills branch.
          The old page lives on as a deep-link for power users via /bill-analysis/legacy. */}
      <Route path="/bill-analysis" element={<Navigate to="/get-quote" replace />} />
      <Route path="/bill-analysis/legacy" element={<BillAnalysisPage />} />
      <Route path="/get-quote" element={<GetQuotePage />} />

      {/* POC — new quote flow spike (bill → map → design → 3-tier). Not linked. */}
      <Route
        path="/poc/quote"
        element={
          <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" /></div>}>
            <PocQuotePage />
          </Suspense>
        }
      />

      {/* B-1 — Customer-facing magic-link viewer.
          Public (no auth), gated only by the unguessable share_token UUID
          generated on each projects_v2 row. */}
      <Route path="/p/:token" element={<PublicProposalPage />} />

      <Route
        path="/pm/*"
        element={
          <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" /></div>}>
            <PmApp />
          </Suspense>
        }
      />

      <Route path="/portal" element={<ProtectedRoute><PortalLayout /></ProtectedRoute>}>
        <Route index element={<DashboardPage />} />
        <Route path="deals" element={<DealsPage />} />
        <Route path="sales" element={<SalesPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="pipeline" element={<PipelinePage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="campaigns" element={<CampaignsPage />} />
        <Route path="email-analytics" element={<EmailAnalyticsPage />} />
        <Route path="lead-scoring" element={<LeadScoringPage />} />
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="enquiries" element={<EnquiriesPage />} />
        <Route path="enquiries/:id" element={<EnquiryDetailPage />} />
        <Route path="companies" element={<CompaniesPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="finance" element={<AdminRoute><FinanceApplicationsPage /></AdminRoute>} />
        <Route path="overrides" element={<OverrideRequestsPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="packages" element={<PackagesPage />} />
        <Route path="trade-requests" element={<TradeRequestsPage />} />
      </Route>
    </Routes>
  );
}
