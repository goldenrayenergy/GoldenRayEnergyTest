export const PIPE_STAGES = [
  { id: 'new', label: 'New', color: '#6366f1' },
  { id: 'qualified', label: 'Qualified', color: '#8b5cf6' },
  { id: 'survey', label: 'Survey', color: '#a78bfa' },
  { id: 'proposal_gen', label: 'Proposed', color: '#f59e0b' },
  { id: 'proposal_sent', label: 'Sent', color: '#3b82f6' },
  { id: 'followup', label: 'Follow-Up', color: '#06b6d4' },
  { id: 'negotiation', label: 'Negotiating', color: '#f97316' },
  { id: 'won', label: 'Won', color: '#10b981' },
  { id: 'lost', label: 'Lost', color: '#ef4444' },
];

export const DEAL_STAGES = [
  { id: 'appointment', label: 'Appointment Set', prob: 10, color: '#6366f1' },
  { id: 'qualified', label: 'Qualified to Buy', prob: 25, color: '#8b5cf6' },
  { id: 'presentation', label: 'Presentation', prob: 40, color: '#f59e0b' },
  { id: 'proposal', label: 'Proposal Made', prob: 60, color: '#3b82f6' },
  { id: 'negotiation', label: 'Negotiation', prob: 80, color: '#f97316' },
  { id: 'closed_won', label: 'Closed Won', prob: 100, color: '#10b981' },
  { id: 'closed_lost', label: 'Closed Lost', prob: 0, color: '#ef4444' },
];

export const SYSTEM_TYPES = [
  { id: 'on-grid', label: 'On-Grid', icon: '⚡', color: '#2563eb' },
  { id: 'off-grid', label: 'Off-Grid', icon: '🔋', color: '#059669' },
  { id: 'hybrid', label: 'Hybrid', icon: '🔄', color: '#7c3aed' },
];

export const CHART_COLORS = ['#6366f1','#8b5cf6','#f59e0b','#3b82f6','#10b981','#f97316','#06b6d4','#ef4444'];

export const ROLES = {
  admin: { label: 'Admin', color: '#dc2626' },
  sales_mgr: { label: 'Sales Mgr', color: '#7c3aed' },
  sales_exec: { label: 'Sales Exec', color: '#2563eb' },
  proposal_mgr: { label: 'Proposals', color: '#d97706' },
};

export const NZ_LOCATIONS = ['Auckland','Wellington','Christchurch','Hamilton','Tauranga','Queenstown','Dunedin','Nelson','Napier','Marlborough'];
