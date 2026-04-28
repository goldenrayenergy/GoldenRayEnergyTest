import { useState, useEffect } from 'react';
import { Loader2, Plus, Save } from 'lucide-react';
import api from '../../services/api';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { DEAL_STAGES, PIPE_STAGES, NZ_LOCATIONS } from '../../utils/constants';

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const num = (v) => v === '' || v == null ? null : Number(v);
const toDateInput = (v) => (v ? String(v).slice(0, 10) : '');

const Label = ({ children }) => <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">{children}</label>;
const baseCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-amber-400 transition bg-white';

const Field = ({ label, name, value, onChange, type = 'text', placeholder, required, step }) => (
  <div>
    <Label>{label}{required && <span className="text-red-400"> *</span>}</Label>
    <input type={type} name={name} value={value ?? ''} onChange={onChange} placeholder={placeholder} step={step} className={baseCls} />
  </div>
);

const Select = ({ label, name, value, onChange, options, required, placeholder = 'Select...' }) => (
  <div>
    <Label>{label}{required && <span className="text-red-400"> *</span>}</Label>
    <select name={name} value={value ?? ''} onChange={onChange} className={baseCls}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

const TextArea = ({ label, name, value, onChange, placeholder, rows = 2 }) => (
  <div className="col-span-2">
    <Label>{label}</Label>
    <textarea name={name} value={value ?? ''} onChange={onChange} rows={rows} placeholder={placeholder}
      className={baseCls + ' resize-y min-h-[56px]'} />
  </div>
);

function FormShell({ open, onClose, title, onSubmit, submitting, error, children, isEdit }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-red-600 text-xs">{error}</div>}
        <div className="grid grid-cols-2 gap-3">{children}</div>
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-50 transition">Cancel</button>
          <Button size="md" icon={submitting ? Loader2 : (isEdit ? Save : Plus)} disabled={submitting}>
            {submitting ? 'Saving...' : (isEdit ? 'Save changes' : 'Create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function useForm(defaults, initial) {
  const [form, setForm] = useState(defaults);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const onChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  const seed = () => { setForm(initial ? { ...defaults, ...initial } : defaults); setError(''); };
  return { form, setForm, onChange, submitting, setSubmitting, error, setError, seed };
}

// Shared edit/create submit helper: returns the saved record
async function saveRecord({ url, id, payload }) {
  if (id) return (await api.patch(`${url}/${id}`, payload)).data;
  return (await api.post(url, payload)).data;
}

// ════════════════════════════════════════════════════════════════════
// Contact / Lead
// ════════════════════════════════════════════════════════════════════
export function NewContactModal({ open, onClose, onCreated, onSaved, initial }) {
  const isEdit = !!initial?.id;
  const f = useForm(
    { name: '', email: '', phone: '', type: 'residential', system_type: 'on-grid', location: '', monthly_bill: '', stage: 'new', source: 'manual', estimated_value: '', lead_score: 50, notes: '' },
    initial,
  );

  useEffect(() => { if (open) f.seed(); /* eslint-disable-next-line */ }, [open, initial?.id]);

  const submit = async (e) => {
    e.preventDefault();
    if (!f.form.name?.trim()) { f.setError('Contact name is required.'); return; }
    f.setSubmitting(true); f.setError('');
    try {
      const payload = { ...f.form, monthly_bill: num(f.form.monthly_bill), estimated_value: num(f.form.estimated_value), lead_score: num(f.form.lead_score) };
      const data = await saveRecord({ url: '/leads', id: initial?.id, payload });
      if (!isEdit) api.post('/activities', { type: 'system', description: `New contact added: ${f.form.name}`, contact_id: data.id }).catch(() => {});
      (onSaved || onCreated)?.(data); onClose();
    } catch (err) { f.setError(err.response?.data?.error || 'Failed to save contact.'); }
    finally { f.setSubmitting(false); }
  };

  return (
    <FormShell open={open} onClose={onClose} title={isEdit ? 'Edit Contact' : 'New Contact / Lead'} onSubmit={submit} submitting={f.submitting} error={f.error} isEdit={isEdit}>
      <Field label="Full name" name="name" value={f.form.name} onChange={f.onChange} required placeholder="Aroha Patel" />
      <Field label="Email" name="email" type="email" value={f.form.email} onChange={f.onChange} placeholder="aroha@example.co.nz" />
      <Field label="Phone" name="phone" value={f.form.phone} onChange={f.onChange} placeholder="+64 21 123 4567" />
      <Select label="Type" name="type" value={f.form.type} onChange={f.onChange} options={[{ value: 'residential', label: 'Residential' }, { value: 'commercial', label: 'Commercial' }]} />
      <Select label="System type" name="system_type" value={f.form.system_type} onChange={f.onChange} options={[{ value: 'on-grid', label: 'On-grid' }, { value: 'hybrid', label: 'Hybrid' }, { value: 'off-grid', label: 'Off-grid' }]} />
      <Select label="Location" name="location" value={f.form.location} onChange={f.onChange} options={NZ_LOCATIONS.map(c => ({ value: c, label: c }))} placeholder="Pick region..." />
      <Field label="Monthly bill ($)" name="monthly_bill" type="number" step="0.01" value={f.form.monthly_bill} onChange={f.onChange} placeholder="420" />
      <Field label="Value ($)" name="estimated_value" type="number" step="0.01" value={f.form.estimated_value} onChange={f.onChange} placeholder="12000" />
      <Field label="Lead score" name="lead_score" type="number" value={f.form.lead_score} onChange={f.onChange} placeholder="50" />
      <Select label="Stage" name="stage" value={f.form.stage} onChange={f.onChange} options={PIPE_STAGES.map(s => ({ value: s.id, label: s.label }))} />
      <Select label="Source" name="source" value={f.form.source} onChange={f.onChange} options={[
        { value: 'manual', label: 'Manual entry' }, { value: 'website', label: 'Website form' }, { value: 'referral', label: 'Referral' },
        { value: 'email', label: 'Email campaign' }, { value: 'paid', label: 'Paid ads' }, { value: 'event', label: 'Event' },
      ]} />
      <TextArea label="Notes" name="notes" value={f.form.notes} onChange={f.onChange} placeholder="Requirements, roof details, follow-ups..." />
    </FormShell>
  );
}

// ════════════════════════════════════════════════════════════════════
// Company
// ════════════════════════════════════════════════════════════════════
export function NewCompanyModal({ open, onClose, onCreated, onSaved, initial }) {
  const isEdit = !!initial?.id;
  const f = useForm(
    { name: '', domain: '', industry: '', size: '', city: '', annual_revenue: '', lifecycle: 'lead', notes: '' },
    initial,
  );

  useEffect(() => { if (open) f.seed(); /* eslint-disable-next-line */ }, [open, initial?.id]);

  const submit = async (e) => {
    e.preventDefault();
    if (!f.form.name?.trim()) { f.setError('Company name is required.'); return; }
    f.setSubmitting(true); f.setError('');
    try {
      const data = await saveRecord({ url: '/companies', id: initial?.id, payload: f.form });
      (onSaved || onCreated)?.(data); onClose();
    } catch (err) { f.setError(err.response?.data?.error || 'Failed to save company.'); }
    finally { f.setSubmitting(false); }
  };

  return (
    <FormShell open={open} onClose={onClose} title={isEdit ? 'Edit Company' : 'New Company'} onSubmit={submit} submitting={f.submitting} error={f.error} isEdit={isEdit}>
      <Field label="Company name" name="name" value={f.form.name} onChange={f.onChange} required placeholder="Mega Foods Ltd" />
      <Field label="Domain" name="domain" value={f.form.domain} onChange={f.onChange} placeholder="megafoods.co.nz" />
      <Select label="Industry" name="industry" value={f.form.industry} onChange={f.onChange} options={[
        'Manufacturing', 'Retail', 'Hospitality', 'Agriculture', 'Healthcare', 'Education', 'Technology', 'Real Estate', 'Other',
      ].map(x => ({ value: x, label: x }))} />
      <Select label="Size" name="size" value={f.form.size} onChange={f.onChange} options={['1-10', '11-50', '51-200', '201-500', '500+'].map(x => ({ value: x, label: `${x} employees` }))} />
      <Select label="City" name="city" value={f.form.city} onChange={f.onChange} options={NZ_LOCATIONS.map(c => ({ value: c, label: c }))} />
      <Select label="Annual revenue" name="annual_revenue" value={f.form.annual_revenue} onChange={f.onChange} options={['<$1M', '$1M-$5M', '$5M-$25M', '$25M-$100M', '$100M+'].map(x => ({ value: x, label: x }))} />
      <Select label="Lifecycle" name="lifecycle" value={f.form.lifecycle} onChange={f.onChange} options={[
        { value: 'lead', label: 'Lead' }, { value: 'opportunity', label: 'Opportunity' }, { value: 'customer', label: 'Customer' }, { value: 'churned', label: 'Churned' },
      ]} />
      <TextArea label="Notes" name="notes" value={f.form.notes} onChange={f.onChange} placeholder="Decision makers, site details..." />
    </FormShell>
  );
}

// ════════════════════════════════════════════════════════════════════
// Deal
// ════════════════════════════════════════════════════════════════════
export function NewDealModal({ open, onClose, onCreated, onSaved, initial }) {
  const isEdit = !!initial?.id;
  const f = useForm(
    { name: '', amount: '', stage: 'appointment', close_date: plusDays(30), priority: 'medium', probability: 10, deal_type: 'New Business', contact_id: '', company_id: '', notes: '' },
    initial ? { ...initial, close_date: toDateInput(initial.close_date) } : null,
  );
  const [contacts, setContacts] = useState([]);
  const [companies, setCompanies] = useState([]);

  useEffect(() => { if (open) {
    f.seed();
    api.get('/leads?limit=500').then(r => setContacts(r.data)).catch(() => {});
    api.get('/companies').then(r => setCompanies(r.data)).catch(() => {});
  } /* eslint-disable-next-line */ }, [open, initial?.id]);

  useEffect(() => {
    const s = DEAL_STAGES.find(x => x.id === f.form.stage);
    if (s) f.setForm(cur => ({ ...cur, probability: s.prob }));
    // eslint-disable-next-line
  }, [f.form.stage]);

  const submit = async (e) => {
    e.preventDefault();
    if (!f.form.name?.trim()) { f.setError('Deal name is required.'); return; }
    if (!f.form.amount) { f.setError('Deal amount is required.'); return; }
    f.setSubmitting(true); f.setError('');
    try {
      const payload = { ...f.form, amount: num(f.form.amount), probability: num(f.form.probability), contact_id: f.form.contact_id || null, company_id: f.form.company_id || null };
      const data = await saveRecord({ url: '/deals', id: initial?.id, payload });
      if (!isEdit) api.post('/activities', { type: 'system', description: `New deal: ${f.form.name} — $${Number(f.form.amount).toLocaleString()}`, deal_id: data.id, contact_id: payload.contact_id }).catch(() => {});
      (onSaved || onCreated)?.(data); onClose();
    } catch (err) { f.setError(err.response?.data?.error || 'Failed to save deal.'); }
    finally { f.setSubmitting(false); }
  };

  return (
    <FormShell open={open} onClose={onClose} title={isEdit ? 'Edit Deal' : 'New Deal'} onSubmit={submit} submitting={f.submitting} error={f.error} isEdit={isEdit}>
      <Field label="Deal name" name="name" value={f.form.name} onChange={f.onChange} required placeholder="8kW residential — Smith" />
      <Field label="Amount ($)" name="amount" type="number" step="0.01" value={f.form.amount} onChange={f.onChange} required placeholder="12500" />
      <div className="col-span-2">
        <Label>Stage <span className="text-red-400">*</span></Label>
        <div className="flex flex-wrap gap-1.5">
          {DEAL_STAGES.filter(s => s.id !== 'closed_lost').map(s => {
            const active = f.form.stage === s.id;
            return (
              <button key={s.id} type="button" onClick={() => f.setForm(cur => ({ ...cur, stage: s.id }))}
                className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-all ${active ? 'text-white shadow-md scale-[1.02]' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
                style={active ? { background: s.color, borderColor: s.color } : {}}>
                {s.label} · {s.prob}%
              </button>
            );
          })}
        </div>
      </div>
      <Field label="Close date" name="close_date" type="date" value={f.form.close_date} onChange={f.onChange} />
      <Field label="Probability %" name="probability" type="number" value={f.form.probability} onChange={f.onChange} />
      <Select label="Priority" name="priority" value={f.form.priority} onChange={f.onChange} options={[
        { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' },
      ]} />
      <Select label="Contact" name="contact_id" value={f.form.contact_id} onChange={f.onChange} options={contacts.map(c => ({ value: c.id, label: c.name + (c.email ? ` (${c.email})` : '') }))} placeholder="Link to contact..." />
      <Select label="Company" name="company_id" value={f.form.company_id} onChange={f.onChange} options={companies.map(c => ({ value: c.id, label: c.name }))} placeholder="Link to company..." />
      <Field label="Deal type" name="deal_type" value={f.form.deal_type} onChange={f.onChange} placeholder="New Business" />
      <TextArea label="Notes" name="notes" value={f.form.notes} onChange={f.onChange} placeholder="Scope, next steps..." />
    </FormShell>
  );
}

// ════════════════════════════════════════════════════════════════════
// Task
// ════════════════════════════════════════════════════════════════════
export function NewTaskModal({ open, onClose, onCreated, onSaved, initial }) {
  const isEdit = !!initial?.id;
  const f = useForm(
    { title: '', description: '', due_date: plusDays(3), priority: 'medium', status: 'todo', task_type: 'Call', assignee_id: '', contact_id: '', deal_id: '' },
    initial ? { ...initial, due_date: toDateInput(initial.due_date) } : null,
  );
  const [users, setUsers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [deals, setDeals] = useState([]);

  useEffect(() => { if (open) {
    f.seed();
    api.get('/auth/users').then(r => setUsers(r.data)).catch(() => {});
    api.get('/leads?limit=500').then(r => setContacts(r.data)).catch(() => {});
    api.get('/deals').then(r => setDeals(r.data)).catch(() => {});
  } /* eslint-disable-next-line */ }, [open, initial?.id]);

  const submit = async (e) => {
    e.preventDefault();
    if (!f.form.title?.trim()) { f.setError('Task title is required.'); return; }
    f.setSubmitting(true); f.setError('');
    try {
      const payload = { ...f.form, assignee_id: f.form.assignee_id || null, contact_id: f.form.contact_id || null, deal_id: f.form.deal_id || null };
      const data = await saveRecord({ url: '/tasks', id: initial?.id, payload });
      (onSaved || onCreated)?.(data); onClose();
    } catch (err) { f.setError(err.response?.data?.error || 'Failed to save task.'); }
    finally { f.setSubmitting(false); }
  };

  return (
    <FormShell open={open} onClose={onClose} title={isEdit ? 'Edit Task' : 'New Task'} onSubmit={submit} submitting={f.submitting} error={f.error} isEdit={isEdit}>
      <Field label="Title" name="title" value={f.form.title} onChange={f.onChange} required placeholder="Follow up with Smith family" />
      <Select label="Task type" name="task_type" value={f.form.task_type} onChange={f.onChange} options={[
        'Call', 'Email', 'Meeting', 'Site visit', 'Proposal', 'Follow-up', 'Admin', 'Other',
      ].map(x => ({ value: x, label: x }))} />
      <Field label="Due date" name="due_date" type="date" value={f.form.due_date} onChange={f.onChange} />
      <Select label="Priority" name="priority" value={f.form.priority} onChange={f.onChange} options={[
        { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' },
      ]} />
      <Select label="Status" name="status" value={f.form.status} onChange={f.onChange} options={[
        { value: 'todo', label: 'To do' }, { value: 'in_progress', label: 'In progress' }, { value: 'completed', label: 'Completed' },
      ]} />
      <Select label="Assign to" name="assignee_id" value={f.form.assignee_id} onChange={f.onChange} options={users.map(u => ({ value: u.id, label: u.name }))} placeholder="Pick team member..." />
      <Select label="Related contact" name="contact_id" value={f.form.contact_id} onChange={f.onChange} options={contacts.map(c => ({ value: c.id, label: c.name }))} placeholder="Optional..." />
      <Select label="Related deal" name="deal_id" value={f.form.deal_id} onChange={f.onChange} options={deals.map(d => ({ value: d.id, label: d.name }))} placeholder="Optional..." />
      <TextArea label="Description" name="description" value={f.form.description} onChange={f.onChange} placeholder="What needs to happen, details, links..." />
    </FormShell>
  );
}

// ════════════════════════════════════════════════════════════════════
// Campaign
// ════════════════════════════════════════════════════════════════════
export function NewCampaignModal({ open, onClose, onCreated, onSaved, initial }) {
  const isEdit = !!initial?.id;
  const f = useForm(
    { name: '', type: 'email', status: 'draft', channel: 'email', budget: '', spent: '', leads_generated: '', revenue_attributed: '', start_date: today(), end_date: plusDays(30), notes: '' },
    initial ? { ...initial, start_date: toDateInput(initial.start_date), end_date: toDateInput(initial.end_date) } : null,
  );

  useEffect(() => { if (open) f.seed(); /* eslint-disable-next-line */ }, [open, initial?.id]);

  const spent = Number(f.form.spent) || 0;
  const revenue = Number(f.form.revenue_attributed) || 0;
  const roi = spent > 0 ? Math.round(((revenue - spent) / spent) * 100) : null;

  const submit = async (e) => {
    e.preventDefault();
    if (!f.form.name?.trim()) { f.setError('Campaign name is required.'); return; }
    f.setSubmitting(true); f.setError('');
    try {
      const payload = { ...f.form,
        budget: num(f.form.budget),
        spent: num(f.form.spent),
        leads_generated: num(f.form.leads_generated),
        revenue_attributed: num(f.form.revenue_attributed),
      };
      const data = await saveRecord({ url: '/campaigns', id: initial?.id, payload });
      (onSaved || onCreated)?.(data); onClose();
    } catch (err) { f.setError(err.response?.data?.error || 'Failed to save campaign.'); }
    finally { f.setSubmitting(false); }
  };

  return (
    <FormShell open={open} onClose={onClose} title={isEdit ? 'Edit Campaign' : 'New Campaign'} onSubmit={submit} submitting={f.submitting} error={f.error} isEdit={isEdit}>
      <Field label="Campaign name" name="name" value={f.form.name} onChange={f.onChange} required placeholder="Winter Solar Push 2026" />
      <Select label="Type" name="type" value={f.form.type} onChange={f.onChange} required options={[
        { value: 'email', label: 'Email' }, { value: 'paid', label: 'Paid ads' }, { value: 'event', label: 'Event' },
        { value: 'referral', label: 'Referral' }, { value: 'content', label: 'Content' }, { value: 'social', label: 'Social' },
      ]} />
      <Select label="Channel" name="channel" value={f.form.channel} onChange={f.onChange} options={[
        'email', 'google_ads', 'facebook', 'linkedin', 'instagram', 'referral', 'event', 'organic',
      ].map(x => ({ value: x, label: x.replace('_', ' ') }))} />
      <Select label="Status" name="status" value={f.form.status} onChange={f.onChange} options={[
        { value: 'draft', label: 'Draft' }, { value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }, { value: 'completed', label: 'Completed' },
      ]} />
      <Field label="Budget ($)" name="budget" type="number" step="0.01" value={f.form.budget} onChange={f.onChange} placeholder="5000" />
      <Field label="Spent ($)" name="spent" type="number" step="0.01" value={f.form.spent} onChange={f.onChange} placeholder="3200" />
      <Field label="Leads generated" name="leads_generated" type="number" value={f.form.leads_generated} onChange={f.onChange} placeholder="120" />
      <Field label="Revenue attributed ($)" name="revenue_attributed" type="number" step="0.01" value={f.form.revenue_attributed} onChange={f.onChange} placeholder="28000" />
      <div className="col-span-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-amber-50 via-pink-50 to-violet-50 border border-amber-100">
        <span className="text-[10px] font-semibold text-gray-500 uppercase">Live ROI</span>
        <span className={`text-lg font-extrabold font-display ${roi == null ? 'text-gray-300' : roi >= 100 ? 'text-emerald-600' : roi >= 0 ? 'text-amber-600' : 'text-red-500'}`}>
          {roi == null ? '—' : `${roi}%`}
        </span>
        <span className="text-[10px] text-gray-400 ml-auto">Auto-calculated from Spent & Revenue</span>
      </div>
      <Field label="Start date" name="start_date" type="date" value={f.form.start_date} onChange={f.onChange} />
      <Field label="End date" name="end_date" type="date" value={f.form.end_date} onChange={f.onChange} />
      <TextArea label="Notes" name="notes" value={f.form.notes} onChange={f.onChange} placeholder="Goals, target audience, creative notes..." />
    </FormShell>
  );
}

// ════════════════════════════════════════════════════════════════════
// Shared delete helper
// ════════════════════════════════════════════════════════════════════
export async function confirmDelete({ url, id, label }) {
  if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return false;
  try { await api.delete(`${url}/${id}`); return true; }
  catch (e) { alert('Failed to delete: ' + (e.response?.data?.error || e.message)); return false; }
}
