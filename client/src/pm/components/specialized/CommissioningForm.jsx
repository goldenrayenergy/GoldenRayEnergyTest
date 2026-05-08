import { useEffect, useState } from 'react';
import { pmCommissionAPI, pmProjectsAPI } from '../../services/pmApi';

// ────────────────────────────────────────────────────────────────────────────
// CommissioningForm — the most consequential specialized UX.
//
// Captures all post-install hardware identity + warranty + monitoring data,
// then writes it directly onto projects_v2 (serial numbers, warranty windows,
// monitoring credentials) and computes vpp_capable_hardware via the backend
// lookup. Setting commissioned_at flips the project from "install motion"
// to "operating asset".
//
// Submitting calls POST /api/pm/projects/:id/commission which:
//   - Validates required fields (inverter make/model/serial, panel make/model)
//   - Updates projects_v2 with all hardware/warranty/monitoring fields
//   - Sets vpp_capable_hardware = systemIsVppCapable(...)
//   - Sets commissioned_at = now() (or supplied value)
// ────────────────────────────────────────────────────────────────────────────

const SECTIONS = [
  {
    title: 'Inverter',
    color: 'sky',
    fields: [
      { key: 'inverter_make',   label: 'Make',   required: true,  type: 'select', options: ['Sungrow','Fronius','Tesla','SolarEdge','Enphase','Huawei','Growatt','GoodWe','other'] },
      { key: 'inverter_model',  label: 'Model',  required: true,  type: 'text', placeholder: 'e.g. SH10RT' },
      { key: 'inverter_serial', label: 'Serial #',required: true, type: 'text' },
    ],
  },
  {
    title: 'Battery (if installed)',
    color: 'purple',
    fields: [
      { key: 'battery_make',    label: 'Make',   type: 'select', options: ['','Tesla','Sungrow','BYD','LG','Pylontech','Enphase','other'] },
      { key: 'battery_model',   label: 'Model',  type: 'text', placeholder: 'e.g. SBR096' },
      { key: 'battery_serial',  label: 'Serial #', type: 'text' },
    ],
  },
  {
    title: 'Panels',
    color: 'amber',
    fields: [
      { key: 'panel_make',      label: 'Make',   required: true, type: 'text', placeholder: 'e.g. Jinko, Trina, REC' },
      { key: 'panel_model',     label: 'Model',  required: true, type: 'text', placeholder: 'e.g. Tiger Neo 440W' },
    ],
  },
  {
    title: 'Monitoring',
    color: 'emerald',
    fields: [
      { key: 'monitoring_provider',    label: 'Provider', type: 'select', options: ['','fronius','sungrow','tesla','solaredge','enphase','huawei','growatt','other'] },
      { key: 'monitoring_external_id', label: 'System / Site ID', type: 'text', placeholder: 'e.g. SOLARWEB-12345 or iSolarCloud plant ID' },
    ],
  },
  {
    title: 'Warranty windows',
    color: 'rose',
    fields: [
      { key: 'panel_warranty_until',     label: 'Panels until',     type: 'date' },
      { key: 'inverter_warranty_until',  label: 'Inverter until',   type: 'date' },
      { key: 'battery_warranty_until',   label: 'Battery until',    type: 'date' },
      { key: 'workmanship_warranty_until',label:'Workmanship until',type: 'date' },
    ],
  },
  {
    title: 'VPP & sign-off',
    color: 'indigo',
    fields: [
      { key: 'vpp_consented',   label: 'Customer agreed to be approached for VPP',  type: 'boolean' },
      { key: 'commissioned_by', label: 'Commissioned by', required: true, type: 'text' },
      { key: 'commissioned_at', label: 'Commissioned at', required: true, type: 'datetime-local' },
    ],
  },
];

const SECTION_BG = {
  sky:    'bg-sky-50    border-sky-200',
  purple: 'bg-purple-50 border-purple-200',
  amber:  'bg-amber-50  border-amber-200',
  emerald:'bg-emerald-50 border-emerald-200',
  rose:   'bg-rose-50   border-rose-200',
  indigo: 'bg-indigo-50 border-indigo-200',
};

export default function CommissioningForm({ projectId, lane, itemKey, schema, values, currentState, onSave, onProjectChanged }) {
  const [local, setLocal]   = useState(values || {});
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [vppOk, setVppOk]   = useState(null);
  const [catalog, setCatalog] = useState(null);

  useEffect(() => { setLocal(values || {}); }, [values]);

  // Pull the VPP catalog once for client-side compatibility hint
  useEffect(() => {
    pmCommissionAPI.vppCatalog().then(r => setCatalog(r.data)).catch(() => {});
  }, []);

  // Compute VPP-capable indicator client-side as user types
  useEffect(() => {
    if (!catalog) { setVppOk(null); return; }
    const inv = catalog.inverters.find(e => e.make === local.inverter_make &&
      String(local.inverter_model || '').toLowerCase().startsWith(e.model_prefix.toLowerCase()));
    if (!local.inverter_make || !local.inverter_model) { setVppOk(null); return; }
    if (!inv) { setVppOk(false); return; }
    if (!inv.vpp_capable) { setVppOk(false); return; }
    if (local.battery_make || local.battery_model) {
      const bat = catalog.batteries.find(e => e.make === local.battery_make &&
        String(local.battery_model || '').toLowerCase().startsWith(e.model_prefix.toLowerCase()));
      setVppOk(bat?.vpp_capable === true);
    } else {
      setVppOk(true);
    }
  }, [local.inverter_make, local.inverter_model, local.battery_make, local.battery_model, catalog]);

  function set(k, v) {
    setLocal(prev => ({ ...prev, [k]: v }));
  }

  // ── Save fields only (without committing the asset) ──
  async function saveDraft() {
    setSaving(true); setError('');
    try {
      await onSave(local);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Commit: writes serial numbers + warranty + VPP + commissioned_at to projects_v2 ──
  async function commission() {
    setSaving(true); setError('');
    try {
      await onSave(local);  // persist fields first
      const r = await pmCommissionAPI.commission(projectId, local);
      // Advance state to asset_populated
      await pmProjectsAPI.updateLane(projectId, lane, { item: itemKey, target_state: 'asset_populated' });
      await onProjectChanged?.();
      alert(`Commissioned. VPP-capable hardware: ${r.data.vpp_capable_hardware ? 'YES' : 'no'}.`);
    } catch (e) {
      const data = e.response?.data;
      setError(data?.missing ? `Missing: ${data.missing.join(', ')}` : (data?.error || e.message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {error && <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm mb-3">{error}</div>}

      {/* VPP indicator banner */}
      {vppOk !== null && (
        <div className={`mb-4 px-3 py-2 rounded border text-sm ${
          vppOk ? 'bg-green-50 border-green-200 text-green-800' : 'bg-slate-50 border-slate-200 text-slate-600'
        }`}>
          {vppOk
            ? '✓ Hardware is VPP-capable. After commissioning, this asset can be enrolled in the future Goldenray VPP fleet.'
            : 'Hardware is NOT VPP-capable. The asset will still be commissioned normally — VPP enrollment unavailable.'}
        </div>
      )}

      <div className="space-y-3">
        {SECTIONS.map(sec => (
          <div key={sec.title} className={`border rounded-lg p-3 ${SECTION_BG[sec.color]}`}>
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">{sec.title}</h4>
            <div className="grid grid-cols-2 gap-2">
              {sec.fields.map(f => {
                const v = local[f.key];
                const baseInput = "w-full px-2 py-1.5 border border-slate-300 rounded text-sm bg-white";
                let control;
                if (f.type === 'boolean') {
                  control = (
                    <label className="flex items-center gap-2 px-2 py-1.5 bg-white border border-slate-300 rounded">
                      <input type="checkbox" checked={!!v} onChange={e => set(f.key, e.target.checked)} />
                      <span className="text-sm">{v ? 'Yes' : 'No'}</span>
                    </label>
                  );
                } else if (f.type === 'select') {
                  control = (
                    <select className={baseInput} value={v ?? ''} onChange={e => set(f.key, e.target.value || null)}>
                      {f.options.map(o => <option key={o} value={o}>{o || '— select —'}</option>)}
                    </select>
                  );
                } else {
                  control = (
                    <input
                      type={f.type === 'datetime-local' ? 'datetime-local' : f.type === 'date' ? 'date' : 'text'}
                      className={baseInput}
                      value={v ?? ''}
                      onChange={e => set(f.key, e.target.value || null)}
                      placeholder={f.placeholder}
                    />
                  );
                }
                return (
                  <div key={f.key}>
                    <label className="block text-[11px] font-medium text-slate-700 mb-0.5">
                      {f.label}{f.required && <span className="text-amber-600 ml-0.5">*</span>}
                    </label>
                    {control}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          onClick={saveDraft}
          disabled={saving}
          className="px-3 py-1.5 border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-sm rounded font-medium">
          {saving ? 'Saving…' : 'Save draft'}
        </button>
        <button
          onClick={commission}
          disabled={saving}
          className="px-4 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm rounded font-medium">
          {saving ? '…' : '⚡ Commission system + populate asset fields'}
        </button>
      </div>
      <p className="text-[11px] text-slate-500 mt-2">
        Commissioning writes serial numbers, warranty windows, monitoring credentials and the VPP-capable flag onto the project, then sets <strong>commissioned_at</strong>. Only do this when the system is live and tested.
      </p>
    </div>
  );
}
