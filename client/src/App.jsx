import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { useAuth } from './context/AuthContext';

// PM Tool (Phase A) — lazy-loaded so it never enters the bundle on portal/website pages.
const PmApp = lazy(() => import('./pm/PmApp'));

// Website pages
import WebsitePage from './pages/WebsitePage';
import FinancePage from './pages/FinancePage';
import FinancingPage from './pages/FinancingPage';
import BookSurveyPage from './pages/BookSurveyPage';
import LoginPage from './pages/LoginPage';
import SolarPackagesPage from './pages/SolarPackagesPage';
import SolarPackageDetailPage from './pages/SolarPackageDetailPage';
import ShopPage from './pages/ShopPage';
import ShopProductDetailPage from './pages/ShopProductDetailPage';
import BillAnalysisPage from './pages/BillAnalysisPage';
import GetQuotePage from './pages/GetQuotePage';
// Phase B3 (2026-08-21) — 30-second landing page that sells the merged
// residential quote flow before the customer commits to the wizard. Sits
// at /get-quote/preview so the current /get-quote wizard URL is unchanged.
// [OWNER] approve copy/stats before promoting this URL widely.
import GetQuoteLanding from './pages/quote/GetQuoteLanding';
// Phase B2 I3 (2026-08-21) — magic-link resume for the merged /get-quote
// residential wizard. Route: /get-quote/resume/:token. Deliberately not
// lazy-loaded — it mounts ResidentialWizard synchronously with server-side
// hydration payload, so lazy would add a spinner-flash on top of the API
// fetch that ResumeQuotePage already handles.
import ResumeQuotePage from './pages/quote/ResumeQuotePage';
import PublicProposalPage from './pages/PublicProposalPage';

// POC — new public quote flow spike; unlinked from anywhere, reachable only
// by direct URL. Lazy-loaded so it doesn't add weight to the main bundle.
const PocQuotePage = lazy(() => import('./pages/poc/QuotePage'));

// POC 3D — Cesium + Google Photorealistic 3D Tiles smoke test.
// Lazy-loaded because Cesium is ~1.5 MB gzipped; loading it on the landing
// page would kill perf. Separate from the 2D POC quote page so nothing
// existing breaks while the 3D rebuild is in progress.
const CesiumSmokeTest = lazy(() => import('./pages/poc/3d/CesiumSmokeTest'));

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
import ReferralsPage from './pages/portal/ReferralsPage';
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
      {/* Public financing info page — Phase 1 of Step-5 What-Next rebuild
          (2026-08-22). Distinct from /finance which is the admin
          applications inbox. Step 5's "See financing options" CTA points
          here so customers get real content, not the login screen. */}
      <Route path="/financing" element={<FinancingPage />} />
      {/* Public site-survey booking — Phase 2 of Step-5 What-Next rebuild
          (2026-08-22). Embeds Cal.com's inline widget for the goldenrayenergy
          /sitesurvey event type. Cal.com handles the whole booking lifecycle
          (calendar sync, confirmation email, reminders, reschedule). Our
          backend is untouched — this route just delivers the widget. */}
      <Route path="/book-survey" element={<BookSurveyPage />} />
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
      {/* Phase B3 landing page — sits at /preview so /get-quote wizard URL unchanged. */}
      <Route path="/get-quote/preview" element={<GetQuoteLanding />} />
      {/* Phase B2 I3 (2026-08-21) — bail-out magic-link resume. Token = enquiry.id UUID. */}
      <Route path="/get-quote/resume/:token" element={<ResumeQuotePage />} />

      {/* POC routes — DEV-ONLY (Phase E revision, 2026-08-21).
          `import.meta.env.DEV` is true under `npm run dev`, false under
          `npm run build`. Vite dead-code-eliminates the whole block at
          production build time, so /poc/quote + /poc/3d-test physically
          don't exist in the deployed bundle. POC code stays in the repo
          + still bundled (the /get-quote steps import shared components
          from QuotePage.jsx); only the CUSTOMER-VISIBLE ROUTES are gated.
          Server-side, all quote-flow API endpoints (bills, roof, places,
          design, threed, aerial) are now at their natural /api/* URLs —
          no ENABLE_POC gate anymore. The dev-only /poc/quote page uses
          POST /api/quote/legacy-submit for its distinct payload shape. */}
      {import.meta.env.DEV && (
        <>
          <Route
            path="/poc/quote"
            element={
              <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" /></div>}>
                <PocQuotePage />
              </Suspense>
            }
          />
          <Route
            path="/poc/3d-test"
            element={
              <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-white bg-black"><div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" /></div>}>
                <CesiumSmokeTest />
              </Suspense>
            }
          />
        </>
      )}

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
        {/* Referral program admin — Phase 3 (2026-08-22). Public routes
            for customers live at /api/referrals/status + /generate; the
            admin CRUD here fetches from /api/referrals/admin (requires
            portal session, enforced server-side). */}
        <Route path="referrals" element={<ReferralsPage />} />
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
