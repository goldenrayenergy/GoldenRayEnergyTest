import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';

// Website pages
import WebsitePage from './pages/WebsitePage';
import FinancePage from './pages/FinancePage';
import LoginPage from './pages/LoginPage';

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
      </Route>
    </Routes>
  );
}
