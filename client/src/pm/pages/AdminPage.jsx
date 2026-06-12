import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { pmAdminAPI } from '../services/pmApi';
import { fmt$, fmtDateLong } from '../../utils/format';
import { bootstrapFieldLimits } from '../utils/fieldHints';

// ────────────────────────────────────────────────────────────────────────────
// /pm/admin — single page with three tabs:
//   1. Company Settings   — bank, phone, signer, logo, validity windows,
//                            FAQ + Why-us copy, closing statement
//   2. Financing Options  — table of bank loan products shown on proposals
//   3. T&Cs Versions      — versioned terms; only one is "current"
// ────────────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [tab, setTab] = useState('settings');
  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Admin Settings</h1>
          <p className="text-xs text-slate-500 mt-1">Company config that drives proposal generation. Edit once, every future proposal reflects it.</p>
        </div>
        <Link
          to="/pm/admin/qr-codes"
          className="px-3 py-2 bg-white hover:bg-amber-50 text-amber-700 rounded-md font-medium text-sm border border-amber-300 whitespace-nowrap">
          📱 QR Code Campaigns →
        </Link>
      </div>

      <nav className="flex border-b border-slate-200 mb-5">
        {[
          { id: 'settings',  label: 'Company Settings' },
          { id: 'financing', label: 'Financing Options' },
          { id: 'terms',     label: 'T&Cs Versions' },
          { id: 'labour',    label: 'Labour & Compliance' },
          { id: 'limits',    label: 'Field Limits' },
          { id: 'import',    label: 'Data Import' },
          { id: 'catalogue', label: 'Catalogue CSV' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 ${
              tab === t.id
                ? 'border-amber-500 text-amber-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'settings'  && <SettingsTab />}
      {tab === 'financing' && <FinancingTab />}
      {tab === 'terms'     && <TermsTab />}
      {tab === 'labour'    && <LabourComplianceTab />}
      {tab === 'limits'    && <FieldLimitsTab />}
      {tab === 'import'    && <ImportTab />}
      {tab === 'catalogue' && <CatalogueCsvTab />}
    </div>
  );
}

// ── Field Limits tab (Session B) ─────────────────────────────────────────
// Admin-tunable hard/typical ranges that drive the server config validator
// AND the inline hint text rendered under every editable spec field. Edits
// require a reason (audit-logged) — same pattern as labour margin% edits.
//
// After save: the server invalidates its in-process cache AND we re-call
// bootstrapFieldLimits() so the OPEN client tab sees the new value in its
// hint text immediately (no reload needed).
function FieldLimitsTab() {
  const [rows, setRows] = useState([]);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  function load() {
    setLoading(true);
    Promise.all([
      pmAdminAPI.listFieldLimits(),
      pmAdminAPI.listFieldLimitsAudit(null, 20),
    ])
      .then(([r, a]) => { setRows(r.data.rows || []); setAudit(a.data.rows || []); })
      .catch(e => setErr(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  function flashMsg(m) { setMsg(m); setTimeout(() => setMsg(''), 2500); }

  async function save(row) {
    setErr('');
    try {
      await pmAdminAPI.updateFieldLimit(row.path, {
        hard_min:    Number(row.hard_min),
        hard_max:    Number(row.hard_max),
        typical_min: Number(row.typical_min),
        typical_max: Number(row.typical_max),
        unit:        row.unit,
        notes:       row.notes,
        reason:      row.reason,
      });
      // Re-merge into the in-memory hint cache so this tab + other open tabs
      // pick up the new value without reload.
      await bootstrapFieldLimits(api);
      setEditing(null);
      flashMsg(`Updated ${row.path} ✓`);
      load();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    }
  }

  // Group rows by section prefix (system.* / bills.*) for readability.
  const grouped = rows.reduce((acc, r) => {
    const section = r.path.split('.', 1)[0] || 'other';
    (acc[section] = acc[section] || []).push(r);
    return acc;
  }, {});

  return (
    <div className="max-w-5xl space-y-5">
      {err && <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm">{err}</div>}
      {msg && <div className="bg-green-50 border border-green-200 text-green-800 px-3 py-2 rounded text-sm">{msg}</div>}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <div className="text-sm font-semibold text-amber-900 mb-1">Admin-tunable validator ranges</div>
        <p className="text-xs text-amber-800 leading-relaxed">
          <b>Hard range</b> = engine rejects values outside this on save.{' '}
          <b>Typical band</b> = informational only; shown to reps as "Typical NZ residential X-Y".
          Changes take effect on the next validate / live-preview run (server cache invalidates immediately).
          Every edit needs a reason (≥10 chars) and is logged to <code className="bg-white px-1 rounded">field_limits_audit</code>.
        </p>
      </div>

      {loading ? (
        <div className="text-slate-400 text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-slate-500 text-sm italic">
          No field_limits rows. Run migration 030 (server/db/apply-migration-030.js) to seed defaults.
        </div>
      ) : (
        Object.entries(grouped).map(([section, sectionRows]) => (
          <div key={section} className="bg-white border border-slate-200 rounded-lg">
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-200">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide">{section}</h3>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-white text-xs text-slate-600 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Path</th>
                  <th className="px-3 py-2 text-right">Hard min</th>
                  <th className="px-3 py-2 text-right">Hard max</th>
                  <th className="px-3 py-2 text-right">Typical min</th>
                  <th className="px-3 py-2 text-right">Typical max</th>
                  <th className="px-3 py-2 text-left">Unit</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sectionRows.map(r => (
                  <tr key={r.path}>
                    <td className="px-3 py-2 font-mono text-[11px]">{r.path}</td>
                    <td className="px-3 py-2 text-right">{Number(r.hard_min)}</td>
                    <td className="px-3 py-2 text-right">{Number(r.hard_max)}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{Number(r.typical_min)}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{Number(r.typical_max)}</td>
                    <td className="px-3 py-2 text-slate-600">{r.unit || '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => setEditing({ ...r, reason: '' })} className="text-amber-700 hover:underline text-xs">Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}

      {/* Recent audit entries */}
      {audit.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">Recent changes</h3>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600 uppercase">
              <tr>
                <th className="px-2 py-1.5 text-left">When</th>
                <th className="px-2 py-1.5 text-left">Path</th>
                <th className="px-2 py-1.5 text-right">Prev hard</th>
                <th className="px-2 py-1.5 text-right">New hard</th>
                <th className="px-2 py-1.5 text-left">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {audit.map(a => (
                <tr key={a.id}>
                  <td className="px-2 py-1.5 whitespace-nowrap">{fmtDateLong(a.occurred_at)}</td>
                  <td className="px-2 py-1.5 font-mono text-[10px]">{a.path}</td>
                  <td className="px-2 py-1.5 text-right text-slate-500">{Number(a.prev_hard_min)}–{Number(a.prev_hard_max)}</td>
                  <td className="px-2 py-1.5 text-right">{Number(a.new_hard_min)}–{Number(a.new_hard_max)}</td>
                  <td className="px-2 py-1.5 italic text-slate-600 truncate max-w-[20rem]" title={a.reason}>{a.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <FieldLimitEditorModal row={editing} onSave={save} onCancel={() => setEditing(null)} />}
    </div>
  );
}

function FieldLimitEditorModal({ row, onSave, onCancel }) {
  const [v, setV] = useState(row);
  const set = (k, val) => setV(p => ({ ...p, [k]: val }));

  // Track whether anything actually changed — if not, save is disabled.
  const changed =
    Number(v.hard_min)    !== Number(row.hard_min)    ||
    Number(v.hard_max)    !== Number(row.hard_max)    ||
    Number(v.typical_min) !== Number(row.typical_min) ||
    Number(v.typical_max) !== Number(row.typical_max) ||
    (v.unit  || '') !== (row.unit  || '') ||
    (v.notes || '') !== (row.notes || '');

  const reasonOk = (v.reason || '').trim().length >= 10;
  const numbersOk = [v.hard_min, v.hard_max, v.typical_min, v.typical_max].every(n =>
    Number.isFinite(Number(n)));
  const rangesOk =
    Number(v.hard_min) < Number(v.hard_max) &&
    Number(v.typical_min) >= Number(v.hard_min) &&
    Number(v.typical_max) <= Number(v.hard_max) &&
    Number(v.typical_min) <= Number(v.typical_max);

  const canSave = changed && reasonOk && numbersOk && rangesOk;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <h3 className="font-bold text-lg mb-1">Edit field limit</h3>
        <p className="text-[11px] font-mono text-slate-500 mb-4">{v.path}</p>

        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Hard min"    v={v.hard_min}    onChange={x => set('hard_min', x)} />
          <NumberField label="Hard max"    v={v.hard_max}    onChange={x => set('hard_max', x)} />
          <NumberField label="Typical min" v={v.typical_min} onChange={x => set('typical_min', x)} />
          <NumberField label="Typical max" v={v.typical_max} onChange={x => set('typical_max', x)} />
        </div>
        {!rangesOk && (
          <p className="text-[11px] text-red-600 mt-2">
            Hard range must satisfy hard_min &lt; hard_max. Typical band must fit within hard range and typical_min ≤ typical_max.
          </p>
        )}

        <div className="mt-3">
          <label className="block text-xs font-medium text-slate-700 mb-1">Unit</label>
          <input type="text" value={v.unit ?? ''} onChange={e => set('unit', e.target.value)}
                 className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm" />
        </div>

        <div className="mt-3">
          <label className="block text-xs font-medium text-slate-700 mb-1">Notes (shown to admin only)</label>
          <textarea rows={2} value={v.notes || ''} onChange={e => set('notes', e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm"
                    placeholder="e.g. Fronius datasheet min 4 panels/string." />
        </div>

        <div className="mt-3">
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Reason for change <span className="text-red-700">*</span>
            <span className="text-slate-400 font-normal"> · ≥10 chars · audit-logged</span>
          </label>
          <textarea rows={2} value={v.reason || ''} onChange={e => set('reason', e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm"
                    placeholder="e.g. Lifting panel-count max to 80 to support a new 80-panel commercial project." />
          {(v.reason || '').trim().length > 0 && !reasonOk && (
            <p className="text-[11px] text-red-600 mt-1">Reason must be at least 10 characters.</p>
          )}
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={() => onSave(v)} disabled={!canSave}
                  className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded text-sm font-medium">
            Save
          </button>
          <button onClick={onCancel} className="px-4 py-1.5 border border-slate-300 hover:bg-slate-50 rounded text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function NumberField({ label, v, onChange }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
      <input type="number" step="any" value={v ?? ''} onChange={e => onChange(e.target.value)}
             className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm" />
    </div>
  );
}

// ── Catalogue CSV tab — labour + compliance rate-card refresh ────────────
function CatalogueCsvTab() {
  const [imports, setImports] = useState([]);
  const [loadingImports, setLoadingImports] = useState(true);
  const [err, setErr] = useState('');

  function load() {
    setLoadingImports(true);
    pmAdminAPI.listCatalogueImports(null, 30)
      .then(r => setImports(r.data.imports || []))
      .catch(e => setErr(e.response?.data?.error || e.message))
      .finally(() => setLoadingImports(false));
  }
  useEffect(load, []);

  return (
    <div className="max-w-5xl space-y-5">
      {err && <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm">{err}</div>}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <div className="text-sm font-semibold text-amber-900 mb-1">Refresh rate-cards via CSV</div>
        <p className="text-xs text-amber-800 leading-relaxed">
          Upload a CSV to replace labour or compliance prices in bulk. Rows upsert by <code className="bg-white px-1 rounded">sku</code>.
          A reason (≥10 chars) is required and stored in the audit log. The in-process catalogue cache
          is invalidated immediately — reps will see new prices on their next live preview.
        </p>
        <div className="mt-2 flex gap-3 text-xs">
          <a href={`/api${pmAdminAPI.catalogueTemplateUrl('labour')}`} className="text-amber-700 hover:underline">↓ Labour template CSV</a>
          <a href={`/api${pmAdminAPI.catalogueTemplateUrl('compliance')}`} className="text-amber-700 hover:underline">↓ Compliance template CSV</a>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <UploadCsvCard kind="labour"     onSuccess={load} />
        <UploadCsvCard kind="compliance" onSuccess={load} />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900">Recent imports</h3>
          <button onClick={load} className="text-xs text-amber-700 hover:underline">Refresh</button>
        </div>
        {loadingImports ? (
          <div className="text-xs text-slate-400">Loading…</div>
        ) : imports.length === 0 ? (
          <div className="text-xs text-slate-500 italic">No imports yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600 uppercase">
              <tr>
                <th className="px-2 py-1.5 text-left">When</th>
                <th className="px-2 py-1.5 text-left">Target</th>
                <th className="px-2 py-1.5 text-left">File</th>
                <th className="px-2 py-1.5 text-right">+</th>
                <th className="px-2 py-1.5 text-right">~</th>
                <th className="px-2 py-1.5 text-right">=</th>
                <th className="px-2 py-1.5 text-right">!</th>
                <th className="px-2 py-1.5 text-left">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {imports.map(r => (
                <tr key={r.id}>
                  <td className="px-2 py-1.5 whitespace-nowrap">{fmtDateLong(r.imported_at)}</td>
                  <td className="px-2 py-1.5 font-mono text-[10px]">{r.target_table.replace('_rate_card','')}</td>
                  <td className="px-2 py-1.5 truncate max-w-[12rem]">{r.csv_filename || '—'}</td>
                  <td className={`px-2 py-1.5 text-right font-semibold ${r.rows_inserted > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>{r.rows_inserted}</td>
                  <td className={`px-2 py-1.5 text-right font-semibold ${r.rows_updated > 0 ? 'text-blue-700' : 'text-slate-400'}`}>{r.rows_updated}</td>
                  <td className="px-2 py-1.5 text-right text-slate-500">{r.rows_unchanged}</td>
                  <td className={`px-2 py-1.5 text-right font-semibold ${r.rows_errored > 0 ? 'text-red-700' : 'text-slate-400'}`}>{r.rows_errored}</td>
                  <td className="px-2 py-1.5 italic text-slate-600 truncate max-w-[16rem]" title={r.reason}>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function UploadCsvCard({ kind, onSuccess }) {
  const [file, setFile]     = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy]     = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError]   = useState('');

  const title = kind === 'labour' ? 'Labour rate-card' : 'Compliance rate-card';

  async function submit() {
    if (!file)            return setError('Pick a CSV file first.');
    if (reason.trim().length < 10) return setError('Reason must be at least 10 chars.');
    setBusy(true); setError(''); setResult(null);
    try {
      const { data } = await pmAdminAPI.importCatalogueCsv(kind, file, reason);
      setResult(data);
      setFile(null);
      setReason('');
      onSuccess?.();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white">
      <h4 className="text-sm font-bold text-slate-900 mb-2">{title}</h4>
      <input
        type="file"
        accept=".csv"
        onChange={e => { setFile(e.target.files?.[0] || null); setResult(null); setError(''); }}
        className="block w-full text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-amber-50 file:text-amber-800 file:font-semibold file:cursor-pointer hover:file:bg-amber-100"
      />
      {file && <p className="text-[11px] text-slate-500 mt-1">{file.name} · {(file.size / 1024).toFixed(1)} KB</p>}

      <div className="mt-3">
        <label className="block text-[11px] font-medium text-slate-700 mb-1">Reason for change (≥10 chars)</label>
        <textarea
          rows={2}
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder={kind === 'labour'
            ? 'e.g. Q2 install crew rate review — +5% to install crew, supervisor unchanged.'
            : 'e.g. ESC fee rose to $135 effective May; design lift to $220.'}
          className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs"
        />
      </div>

      <button
        onClick={submit}
        disabled={!file || busy || reason.trim().length < 10}
        className="mt-3 px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold disabled:opacity-50 inline-flex items-center gap-1.5">
        {busy && <span className="animate-spin inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full" />}
        {busy ? 'Importing…' : `Import ${kind} CSV`}
      </button>

      {error  && <div className="mt-3 px-2 py-1.5 bg-red-50 border border-red-200 rounded text-[11px] text-red-700">{error}</div>}

      {result && (
        <div className="mt-3 px-2 py-2 bg-emerald-50 border border-emerald-200 rounded text-[11px] text-emerald-900 space-y-1">
          <div>
            <b>{result.summary.inserted}</b> inserted ·{' '}
            <b>{result.summary.updated}</b> updated ·{' '}
            <b>{result.summary.unchanged}</b> unchanged
            {result.summary.errored > 0 && <> · <span className="text-red-700"><b>{result.summary.errored}</b> errored</span></>}
          </div>
          {result.summary.errors?.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-red-700">View row errors</summary>
              <ul className="mt-1 ml-3 max-h-32 overflow-y-auto text-red-700 font-mono space-y-0.5">
                {result.summary.errors.slice(0, 50).map((e, i) => (
                  <li key={i}>row {e.row_number}{e.sku ? ` · ${e.sku}` : ''}: {e.message}</li>
                ))}
                {result.summary.errors.length > 50 && (
                  <li className="italic">…{result.summary.errors.length - 50} more</li>
                )}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ── Data Import tab — Supplier setup workbook → 5 tables ─────────────────
function ImportTab() {
  const [file, setFile]     = useState(null);
  const [busy, setBusy]     = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError]   = useState('');

  async function submit() {
    if (!file) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const { data } = await pmAdminAPI.importSupplierData(file);
      setResult(data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <div className="text-sm font-semibold text-amber-900 mb-1">Goldenray Supplier Setup workbook</div>
        <p className="text-xs text-amber-800 leading-relaxed">
          Upload the <code className="bg-white px-1 rounded">Goldenray_Supplier_Setup.xlsx</code> file
          (generated by <code className="bg-white px-1 rounded">server/scripts/build-supplier-setup-xlsx.js</code>{' '}
          and filled in after supplier conversations). Five sheets are imported into Suppliers, Products,
          Compatibility, Region Defaults, and Cost Defaults — these feed the 3-quote engine. Re-uploading
          is safe (rows upsert by short_code / SKU / region_name).
        </p>
      </div>

      <div className="border border-slate-200 rounded-lg p-4 bg-white">
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={e => { setFile(e.target.files?.[0] || null); setResult(null); }}
          className="block w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-amber-50 file:text-amber-800 file:font-semibold file:cursor-pointer hover:file:bg-amber-100"
        />
        {file && <p className="text-xs text-slate-500 mt-2">Selected: <b>{file.name}</b> · {(file.size / 1024).toFixed(1)} KB</p>}

        <button
          onClick={submit}
          disabled={!file || busy}
          className="mt-4 px-4 py-2 rounded-md bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold disabled:opacity-50 inline-flex items-center gap-2">
          {busy ? <span className="animate-spin inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full" /> : null}
          {busy ? 'Importing…' : 'Import workbook'}
        </button>

        {error && <div className="mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{error}</div>}
      </div>

      {result && (
        <div className="border border-slate-200 rounded-lg p-4 bg-white">
          <div className="text-sm font-bold text-slate-900 mb-3">Import result · <span className="font-mono text-xs text-slate-500">{result.filename}</span></div>
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr><th className="text-left py-1.5 px-2">Sheet</th><th className="text-right py-1.5 px-2">Inserted</th><th className="text-right py-1.5 px-2">Updated</th><th className="text-right py-1.5 px-2">Skipped</th><th className="text-right py-1.5 px-2">Errors</th></tr>
            </thead>
            <tbody>
              {Object.entries(result.summary || {}).map(([sheet, r]) => (
                <tr key={sheet} className="border-t border-slate-100">
                  <td className="py-1.5 px-2 font-medium">{sheet}</td>
                  <td className={`py-1.5 px-2 text-right ${r.inserted > 0 ? 'text-emerald-700 font-semibold' : 'text-slate-400'}`}>{r.inserted}</td>
                  <td className={`py-1.5 px-2 text-right ${r.updated > 0 ? 'text-blue-700 font-semibold' : 'text-slate-400'}`}>{r.updated}</td>
                  <td className={`py-1.5 px-2 text-right ${r.skipped > 0 ? 'text-slate-700' : 'text-slate-400'}`}>{r.skipped}</td>
                  <td className={`py-1.5 px-2 text-right ${r.errors?.length > 0 ? 'text-red-700 font-semibold' : 'text-slate-400'}`}>{r.errors?.length || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {result.sheets_skipped?.length > 0 && (
            <div className="mt-3 text-[11px] text-slate-500">
              Sheets ignored (not part of this importer): <code>{result.sheets_skipped.join(', ')}</code>
            </div>
          )}

          {Object.entries(result.summary || {}).map(([sheet, r]) => (
            r.errors?.length > 0 && (
              <div key={sheet} className="mt-3">
                <div className="text-xs font-semibold text-red-800 mb-1">{sheet} — {r.errors.length} error{r.errors.length === 1 ? '' : 's'}</div>
                <ul className="max-h-40 overflow-y-auto text-[11px] bg-red-50 border border-red-200 rounded p-2 space-y-0.5">
                  {r.errors.slice(0, 50).map((e, i) => (
                    <li key={i} className="font-mono text-red-700">Row {e.row}: {e.error}</li>
                  ))}
                  {r.errors.length > 50 && <li className="italic text-red-600">…and {r.errors.length - 50} more</li>}
                </ul>
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}

// ── Settings tab ─────────────────────────────────────────────────────────
function SettingsTab() {
  const [s, setS]       = useState(null);
  const [saving, setSv] = useState(false);
  const [msg, setMsg]   = useState('');
  const [err, setErr]   = useState('');

  useEffect(() => {
    pmAdminAPI.getSettings().then(r => setS(r.data)).catch(e => setErr(e.response?.data?.error || e.message));
  }, []);

  function set(k, v) { setS(p => ({ ...p, [k]: v })); }

  async function save() {
    setSv(true); setMsg(''); setErr('');
    try {
      const patch = { ...s };
      delete patch.id; delete patch.updated_at;
      // Convert numeric inputs (strings → numbers)
      ['crew_capacity_per_week','proposal_validity_days_stage1','proposal_validity_days_stage2',
       'default_deposit_pct','default_progress_pct'].forEach(k => {
        if (patch[k] !== '' && patch[k] != null) patch[k] = Number(patch[k]);
      });
      const r = await pmAdminAPI.updateSettings(patch);
      setS(r.data);
      setMsg('Saved ✓');
      setTimeout(() => setMsg(''), 2000);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setSv(false);
    }
  }

  if (!s) return <div className="text-slate-400 text-sm">Loading…</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      {err && <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm">{err}</div>}
      {msg && <div className="bg-green-50 border border-green-200 text-green-800 px-3 py-2 rounded text-sm">{msg}</div>}

      <Card title="Legal & Contact">
        <Grid>
          <Field label="Legal name"   v={s.legal_name}    set={v => set('legal_name', v)} />
          <Field label="Trading name" v={s.trading_name}  set={v => set('trading_name', v)} />
          <Field label="Contact phone (proposals)" v={s.contact_phone} set={v => set('contact_phone', v)} />
          <Field label="Contact email" v={s.contact_email} set={v => set('contact_email', v)} />
          <Field label="Support phone" v={s.support_phone} set={v => set('support_phone', v)} />
          <Field label="Email From-address" v={s.email_from_address} set={v => set('email_from_address', v)} placeholder='Goldenray <hello@goldenray.energy>' />
        </Grid>
      </Card>

      <Card title="Bank — for deposit instructions">
        <Grid>
          <Field label="Account name" v={s.bank_account_name} set={v => set('bank_account_name', v)} />
          <Field label="Account number" v={s.bank_account_number} set={v => set('bank_account_number', v)} placeholder="12-3456-7890123-00" />
          <Field label="Bank" v={s.bank_name} set={v => set('bank_name', v)} placeholder="ASB Bank" />
          <Field label="Reference template" v={s.bank_reference_template} set={v => set('bank_reference_template', v)} placeholder='${proposal_number}' />
        </Grid>
      </Card>

      <Card title="Default proposal signer">
        <Grid>
          <Field label="Name"  v={s.signer_name} set={v => set('signer_name', v)} />
          <Field label="Title" v={s.signer_title} set={v => set('signer_title', v)} />
          <Field label="Email" v={s.signer_email} set={v => set('signer_email', v)} />
        </Grid>
      </Card>

      <Card title="Branding">
        <Grid>
          <Field label="Logo URL" v={s.logo_url} set={v => set('logo_url', v)} placeholder="/logo.jpg" />
        </Grid>
      </Card>

      <Card title="Operational defaults">
        <Grid>
          <Field label="Crew capacity (installs/week)" type="number" v={s.crew_capacity_per_week} set={v => set('crew_capacity_per_week', v)} />
          <Field label="Stage 1 validity (days)" type="number" v={s.proposal_validity_days_stage1} set={v => set('proposal_validity_days_stage1', v)} />
          <Field label="Stage 2 validity (days)" type="number" v={s.proposal_validity_days_stage2} set={v => set('proposal_validity_days_stage2', v)} />
          <Field label="Deposit % default" type="number" v={s.default_deposit_pct} set={v => set('default_deposit_pct', v)} />
          <Field label="Progress payment % default" type="number" v={s.default_progress_pct} set={v => set('default_progress_pct', v)} />
        </Grid>
      </Card>

      <Card title="Customer-facing copy">
        <Grid>
          <Field label="Closing statement (proposal footer)" type="textarea" rows={3} v={s.closing_statement} set={v => set('closing_statement', v)} />
        </Grid>
        <p className="text-xs text-slate-500 mt-3">
          FAQ and Why-us bullets are stored as JSON. Edit them directly via API for now (UI coming).
          Current FAQ count: <strong>{(s.faq_json || []).length}</strong> · Why-us bullets: <strong>{(s.why_us_json || []).length}</strong>.
        </p>
      </Card>

      <div className="flex gap-3 pt-2">
        <button
          onClick={save}
          disabled={saving}
          className="px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-md font-medium text-sm">
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        <span className="text-xs text-slate-400 self-center">Last updated {fmtDateLong(s.updated_at)}</span>
      </div>
    </div>
  );
}

// ── Financing tab ────────────────────────────────────────────────────────
function FinancingTab() {
  const [opts, setOpts] = useState([]);
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState('');

  function load() {
    pmAdminAPI.listFinancing().then(r => setOpts(r.data)).catch(e => setErr(e.response?.data?.error || e.message));
  }
  useEffect(load, []);

  async function save(opt) {
    setErr('');
    try {
      if (opt.id) await pmAdminAPI.updateFinancing(opt.id, opt);
      else        await pmAdminAPI.createFinancing(opt);
      setEditing(null);
      load();
    } catch (e) { setErr(e.response?.data?.error || e.message); }
  }

  async function remove(id) {
    if (!confirm('Deactivate this financing option? It will be hidden from new proposals.')) return;
    await pmAdminAPI.deleteFinancing(id);
    load();
  }

  return (
    <div className="max-w-4xl">
      {err && <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm mb-3">{err}</div>}

      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-slate-600">Bank loan options shown on every proposal. Update rates when ASB/BNZ change theirs (typically quarterly).</p>
        <button
          onClick={() => setEditing({ name: '', bank: '', base_rate_pct: 5.5, promo_rate_pct: 1, promo_years: 3, term_years: 7, max_amount_nzd: 50000, notes: '', is_active: true, display_order: 50 })}
          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded text-sm font-medium">
          + Add option
        </button>
      </div>

      <table className="w-full text-sm bg-white border border-slate-200 rounded-lg overflow-hidden">
        <thead className="bg-slate-50 text-xs text-slate-600 uppercase">
          <tr>
            <th className="px-3 py-2 text-left">Name</th>
            <th className="px-3 py-2 text-left">Bank</th>
            <th className="px-3 py-2 text-right">Base rate</th>
            <th className="px-3 py-2 text-right">Promo</th>
            <th className="px-3 py-2 text-right">Term</th>
            <th className="px-3 py-2 text-right">Max</th>
            <th className="px-3 py-2 text-center">Active</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {opts.map(o => (
            <tr key={o.id} className={o.is_active ? '' : 'bg-slate-50 text-slate-400'}>
              <td className="px-3 py-2 font-medium">{o.name}</td>
              <td className="px-3 py-2">{o.bank || '—'}</td>
              <td className="px-3 py-2 text-right">{o.base_rate_pct}%</td>
              <td className="px-3 py-2 text-right">{o.promo_rate_pct}% × {o.promo_years}y</td>
              <td className="px-3 py-2 text-right">{o.term_years}y</td>
              <td className="px-3 py-2 text-right">{o.max_amount_nzd ? fmt$(o.max_amount_nzd) : '—'}</td>
              <td className="px-3 py-2 text-center">{o.is_active ? '✓' : '—'}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                <button onClick={() => setEditing(o)} className="text-amber-700 hover:underline text-xs mr-3">Edit</button>
                {o.is_active && <button onClick={() => remove(o.id)} className="text-red-600 hover:underline text-xs">Deactivate</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && <FinancingEditor opt={editing} onSave={save} onCancel={() => setEditing(null)} />}
    </div>
  );
}

function FinancingEditor({ opt, onSave, onCancel }) {
  const [v, setV] = useState(opt);
  const set = (k, val) => setV(p => ({ ...p, [k]: val }));
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg p-6 max-w-lg w-full">
        <h3 className="font-bold text-lg mb-4">{opt.id ? 'Edit option' : 'Add financing option'}</h3>
        <Grid>
          <Field label="Name" v={v.name} set={x => set('name', x)} />
          <Field label="Bank" v={v.bank} set={x => set('bank', x)} />
          <Field label="Base rate %"  type="number" v={v.base_rate_pct}  set={x => set('base_rate_pct', Number(x) || 0)} />
          <Field label="Promo rate %" type="number" v={v.promo_rate_pct} set={x => set('promo_rate_pct', Number(x) || 0)} />
          <Field label="Promo years"  type="number" v={v.promo_years}    set={x => set('promo_years', Number(x) || 0)} />
          <Field label="Term years"   type="number" v={v.term_years}     set={x => set('term_years', Number(x) || 0)} />
          <Field label="Max amount ($)" type="number" v={v.max_amount_nzd} set={x => set('max_amount_nzd', Number(x) || 0)} />
          <Field label="Display order"  type="number" v={v.display_order}  set={x => set('display_order', Number(x) || 0)} />
        </Grid>
        <div className="mt-3">
          <label className="block text-xs font-medium text-slate-700 mb-1">Notes (shown under option on proposals)</label>
          <textarea rows={3} value={v.notes || ''} onChange={e => set('notes', e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm" />
        </div>
        <label className="flex items-center gap-2 mt-3">
          <input type="checkbox" checked={!!v.is_active} onChange={e => set('is_active', e.target.checked)} />
          <span className="text-sm">Active (shown on proposals)</span>
        </label>
        <div className="flex gap-2 mt-5">
          <button onClick={() => onSave(v)} className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded text-sm font-medium">Save</button>
          <button onClick={onCancel} className="px-4 py-1.5 border border-slate-300 hover:bg-slate-50 rounded text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Terms tab ────────────────────────────────────────────────────────────
function TermsTab() {
  const [versions, setVersions] = useState([]);
  const [err, setErr] = useState('');
  const [showNew, setShowNew] = useState(false);

  function load() {
    pmAdminAPI.listTerms().then(r => setVersions(r.data)).catch(e => setErr(e.response?.data?.error || e.message));
  }
  useEffect(load, []);

  return (
    <div className="max-w-3xl">
      {err && <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm mb-3">{err}</div>}

      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-slate-600">Versioned T&Cs. Customers accept a specific version (audit trail). Adding a new version automatically marks it current.</p>
        <button
          onClick={() => setShowNew(true)}
          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded text-sm font-medium">
          + New version
        </button>
      </div>

      <div className="space-y-3">
        {versions.map(v => (
          <div key={v.id} className={`border rounded-lg p-4 ${v.is_current ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
            <div className="flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-900">v{v.version}</span>
                {v.is_current && <span className="ml-2 px-2 py-0.5 bg-emerald-200 text-emerald-900 text-xs rounded font-bold">CURRENT</span>}
                <span className="ml-3 text-xs text-slate-500">effective {fmtDateLong(v.effective_from)}</span>
              </div>
              <span className="text-xs text-slate-400">{(v.terms_json || []).length} sections</span>
            </div>
            {v.notes && <p className="text-xs text-slate-600 mt-1 italic">{v.notes}</p>}
            <details className="mt-2">
              <summary className="text-xs text-amber-700 cursor-pointer hover:underline">View sections</summary>
              <ol className="mt-2 list-decimal list-inside space-y-1 text-xs text-slate-700">
                {(v.terms_json || []).map((t, i) => <li key={i}><strong>{t.title}</strong></li>)}
              </ol>
            </details>
          </div>
        ))}
      </div>

      {showNew && <NewTermsModal onSave={() => { setShowNew(false); load(); }} onCancel={() => setShowNew(false)} />}
    </div>
  );
}

function NewTermsModal({ onSave, onCancel }) {
  const [version, setVersion] = useState('');
  const [effective, setEffective] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setError('');
    try {
      // Clone current terms (admin can edit existing JSON for new version via API later;
      // UI only supports version + effective_from + notes for now)
      const current = await pmAdminAPI.currentTerms();
      const terms_json = current.data?.terms_json || [];
      await pmAdminAPI.createTerms({ version, effective_from: effective, terms_json, notes });
      onSave();
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
        <h3 className="font-bold text-lg mb-4">New T&Cs version</h3>
        {error && <div className="bg-red-50 border border-red-200 text-red-800 px-2 py-1 rounded text-xs mb-3">{error}</div>}
        <Grid>
          <Field label="Version (e.g., 2026.2)" v={version} set={setVersion} />
          <Field label="Effective from" type="date" v={effective} set={setEffective} />
        </Grid>
        <div className="mt-3">
          <label className="block text-xs font-medium text-slate-700 mb-1">Notes (internal)</label>
          <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm" placeholder="What changed in this version?" />
        </div>
        <p className="text-xs text-slate-500 mt-3">
          New version starts as a copy of the current one. Edit specific sections via API for now (full T&Cs editor coming).
        </p>
        <div className="flex gap-2 mt-5">
          <button onClick={submit} disabled={busy || !version} className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded text-sm font-medium">
            {busy ? '…' : 'Create'}
          </button>
          <button onClick={onCancel} className="px-4 py-1.5 border border-slate-300 hover:bg-slate-50 rounded text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Labour & Compliance tab (P8.5) — pointed at labour_rate_card +
// compliance_rate_card (the live tables the proposal engine reads). Replaces
// the old LabourRatesTab that wrote to the dead labour_rates table.
//
// Two sub-tabs (Labour / Compliance). Each shows rows grouped by category
// with inline edit. Margin% edits require a reason (admin policy).
// ────────────────────────────────────────────────────────────────────────────
function LabourComplianceTab() {
  const [sub, setSub] = useState('labour');
  return (
    <div className="max-w-5xl">
      <div className="flex border-b border-slate-200 mb-4">
        {[
          { id: 'labour',     label: 'Labour rates' },
          { id: 'compliance', label: 'Compliance fees' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setSub(t.id)}
            className={`px-3 py-1.5 -mb-px text-xs font-medium border-b-2 ${
              sub === t.id
                ? 'border-amber-500 text-amber-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}>
            {t.label}
          </button>
        ))}
      </div>
      <RateCardEditor kind={sub} key={sub} />
    </div>
  );
}

const RC_LABOUR_CATEGORIES = ['install','battery_install','supervisor','travel','logistics','premium','other'];
const RC_COMPLIANCE_CATEGORIES = ['design','inspection','commissioning','grid_app','certificate','survey','other'];
const RC_CATEGORY_LABEL = {
  install: 'Install', battery_install: 'Battery install', supervisor: 'Supervisor',
  travel: 'Travel', logistics: 'Logistics', premium: 'Premium',
  design: 'Design', inspection: 'Inspection', commissioning: 'Commissioning',
  grid_app: 'Grid application', certificate: 'Certificate', survey: 'Survey',
  other: 'Other',
};

function RateCardEditor({ kind }) {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const categories = kind === 'labour' ? RC_LABOUR_CATEGORIES : RC_COMPLIANCE_CATEGORIES;

  function load() {
    setLoading(true);
    pmAdminAPI.listRateCard(kind)
      .then(r => setRows(r.data.rows || []))
      .catch(e => setErr(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, [kind]);

  function flashMsg(m) { setMsg(m); setTimeout(() => setMsg(''), 2500); }

  async function save(row) {
    setErr('');
    try {
      if (row.__isNew) {
        const { sku, category, name, cost_nzd, margin_pct, default_qty,
                applies_to_kw_min, applies_to_kw_max, active, reason } = row;
        await pmAdminAPI.createRateCardRow(kind, {
          sku, category, name, cost_nzd, margin_pct,
          default_qty: default_qty ?? 1,
          applies_to_kw_min, applies_to_kw_max,
          active: active ?? true,
          reason,
        });
        flashMsg(`Added ${sku} ✓`);
      } else {
        await pmAdminAPI.updateRateCardRow(kind, row.sku, {
          category: row.category, name: row.name, cost_nzd: row.cost_nzd,
          margin_pct: row.margin_pct, default_qty: row.default_qty,
          applies_to_kw_min: row.applies_to_kw_min,
          applies_to_kw_max: row.applies_to_kw_max,
          active: row.active,
          reason: row.reason,
        });
        flashMsg(`Updated ${row.sku} ✓`);
      }
      setEditing(null);
      load();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    }
  }

  async function deactivate(row) {
    const reason = prompt(`Deactivate ${row.sku}? Provide a reason (≥10 chars):`, '');
    if (reason == null) return;
    if (reason.trim().length < 10) return alert('Reason must be at least 10 chars.');
    try {
      await pmAdminAPI.deactivateRateCardRow(kind, row.sku, reason);
      flashMsg(`Deactivated ${row.sku}`);
      load();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    }
  }

  const byCategory = rows.reduce((acc, r) => {
    const c = r.category || 'other';
    (acc[c] = acc[c] || []).push(r);
    return acc;
  }, {});

  function emptyRow() {
    return {
      __isNew: true,
      sku: '', name: '', category: categories[0],
      cost_nzd: 0, margin_pct: 30, default_qty: 1,
      applies_to_kw_min: null, applies_to_kw_max: null,
      active: true, reason: '',
    };
  }

  return (
    <div>
      {err && <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm mb-3">{err}</div>}
      {msg && <div className="bg-green-50 border border-green-200 text-green-800 px-3 py-2 rounded text-sm mb-3">{msg}</div>}

      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-slate-600">
          {kind === 'labour'
            ? 'Labour line items the engine picks per quote based on system kW / battery flag. Edit cost or qty freely; changing margin% requires a reason.'
            : 'Compliance fees the engine adds to every quote. Edit cost / qty freely; changing margin% requires a reason.'}
        </p>
        <button
          onClick={() => setEditing(emptyRow())}
          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded text-sm font-medium">
          + Add {kind === 'labour' ? 'labour row' : 'compliance row'}
        </button>
      </div>

      {loading ? (
        <div className="text-slate-400 text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-slate-500 text-sm italic">No rows yet. Use the Catalogue CSV tab to bulk-load, or click "+ Add" above.</div>
      ) : (
        categories.filter(c => byCategory[c]?.length).map(cat => (
          <div key={cat} className="mb-4">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">
              {RC_CATEGORY_LABEL[cat] || cat}
            </h3>
            <table className="w-full text-sm bg-white border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-50 text-xs text-slate-600 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">SKU</th>
                  <th className="px-3 py-2 text-left">Name</th>
                  {kind === 'labour' && <th className="px-3 py-2 text-left">kW range</th>}
                  <th className="px-3 py-2 text-right">Cost</th>
                  <th className="px-3 py-2 text-right">Margin %</th>
                  <th className="px-3 py-2 text-right">Sell ≈</th>
                  <th className="px-3 py-2 text-right">Default qty</th>
                  <th className="px-3 py-2 text-center">Active</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {byCategory[cat].map(r => {
                  const sell = Number(r.cost_nzd) * (1 + Number(r.margin_pct) / 100);
                  return (
                    <tr key={r.id || r.sku} className={r.active ? '' : 'bg-slate-50 text-slate-400'}>
                      <td className="px-3 py-2 font-mono text-xs">{r.sku}</td>
                      <td className="px-3 py-2">{r.name}</td>
                      {kind === 'labour' && (
                        <td className="px-3 py-2 text-xs">
                          {r.applies_to_kw_min == null && r.applies_to_kw_max == null
                            ? 'any'
                            : `${r.applies_to_kw_min ?? '—'} – ${r.applies_to_kw_max ?? '—'}`}
                        </td>
                      )}
                      <td className="px-3 py-2 text-right font-medium">{fmt$(r.cost_nzd)}</td>
                      <td className="px-3 py-2 text-right">{Number(r.margin_pct).toFixed(0)}%</td>
                      <td className="px-3 py-2 text-right text-slate-500">{fmt$(sell)}</td>
                      <td className="px-3 py-2 text-right">{Number(r.default_qty)}</td>
                      <td className="px-3 py-2 text-center">{r.active ? '✓' : '—'}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button onClick={() => setEditing({ ...r })} className="text-amber-700 hover:underline text-xs mr-3">Edit</button>
                        {r.active && <button onClick={() => deactivate(r)} className="text-red-600 hover:underline text-xs">Deactivate</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}

      {editing && (
        <RateCardEditorModal
          kind={kind}
          row={editing}
          categories={categories}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RateCardEditorModal({ kind, row, categories, onSave, onCancel }) {
  const [v, setV] = useState(row);
  const [marginReasonRequired, setMarginReasonRequired] = useState(false);

  // Watch margin changes — if it differs from the original, force reason input
  useEffect(() => {
    if (row.__isNew) { setMarginReasonRequired(true); return; }
    setMarginReasonRequired(Number(v.margin_pct) !== Number(row.margin_pct));
  }, [v.margin_pct]);

  const set = (k, val) => setV(p => ({ ...p, [k]: val }));
  const canSave =
    v.sku && v.name && v.category &&
    Number.isFinite(Number(v.cost_nzd)) && Number(v.cost_nzd) >= 0 &&
    (!marginReasonRequired || (v.reason && v.reason.trim().length >= 10));

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <h3 className="font-bold text-lg mb-1">
          {row.__isNew ? `Add ${kind} row` : `Edit ${kind} row`}
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          Changes apply to all new quotes immediately. Existing quotes keep their snapshot.
        </p>

        <Grid>
          <Field label="SKU" v={v.sku} set={x => set('sku', x)}
                 placeholder={kind === 'labour' ? 'LAB-INS-7KW' : 'CMP-DSGN'}
                 disabled={!row.__isNew} />
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
            <select value={v.category} onChange={e => set('category', e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm">
              {categories.map(c => <option key={c} value={c}>{RC_CATEGORY_LABEL[c] || c}</option>)}
            </select>
          </div>
        </Grid>
        <div className="mt-3">
          <Field label="Name" v={v.name} set={x => set('name', x)}
                 placeholder={kind === 'labour' ? 'Install crew 3–7kW' : 'Electrical Safety Certificate'} />
        </div>

        <Grid>
          <Field label="Cost ($ NZD ex GST)" type="number" v={v.cost_nzd}
                 set={x => set('cost_nzd', Number(x) || 0)} />
          <Field
            label={`Margin % ${marginReasonRequired ? '· reason required' : ''}`}
            type="number"
            v={v.margin_pct}
            set={x => set('margin_pct', Number(x) || 0)}
          />
          <Field label="Default qty" type="number" v={v.default_qty ?? 1}
                 set={x => set('default_qty', Number(x) || 0)} />
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!v.active} onChange={e => set('active', e.target.checked)} />
              Active (shown to engine)
            </label>
          </div>
        </Grid>

        {kind === 'labour' && (
          <Grid>
            <Field label="Applies min kW (blank = any)" type="number"
                   v={v.applies_to_kw_min ?? ''}
                   set={x => set('applies_to_kw_min', x === '' ? null : Number(x))} />
            <Field label="Applies max kW (blank = any)" type="number"
                   v={v.applies_to_kw_max ?? ''}
                   set={x => set('applies_to_kw_max', x === '' ? null : Number(x))} />
          </Grid>
        )}

        <div className="mt-3">
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Reason {marginReasonRequired ? <span className="text-red-700">*</span> : <span className="text-slate-400">(optional unless changing margin %)</span>}
          </label>
          <textarea
            rows={2}
            value={v.reason || ''}
            onChange={e => set('reason', e.target.value)}
            placeholder="e.g. Crew rates lifted 5% effective May after rate review."
            className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm"
          />
          {marginReasonRequired && (v.reason || '').trim().length < 10 && (
            <p className="text-[11px] text-red-600 mt-1">Reason must be at least 10 characters.</p>
          )}
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={() => onSave(v)} disabled={!canSave}
                  className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded text-sm font-medium">
            Save
          </button>
          <button onClick={onCancel} className="px-4 py-1.5 border border-slate-300 hover:bg-slate-50 rounded text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Reusable form helpers ────────────────────────────────────────────────
function Card({ title, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-3">{title}</h3>
      {children}
    </div>
  );
}
function Grid({ children }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>;
}
function Field({ label, v, set, type = 'text', rows, placeholder, disabled = false }) {
  if (type === 'textarea') {
    return (
      <div className="md:col-span-2">
        <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
        <textarea rows={rows || 3} value={v ?? ''} onChange={e => set(e.target.value)} placeholder={placeholder} disabled={disabled}
          className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm disabled:bg-slate-100 disabled:text-slate-500" />
      </div>
    );
  }
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
      <input type={type} value={v ?? ''} onChange={e => set(e.target.value)} placeholder={placeholder} disabled={disabled}
        className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm disabled:bg-slate-100 disabled:text-slate-500" />
    </div>
  );
}
