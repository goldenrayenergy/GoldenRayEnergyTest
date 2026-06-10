import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { pmQuotesAPI, pmContactsAPI, emptySpec } from '../services/pmQuotesApi';
import { autoSizeSystem } from '../utils/autoSizeSystem';
import { autoSizeThreeTiers, autoSizeThreeTiersFromSpec } from '../utils/autoSizeThreeTiers';

// Step-1 of quote creation: pick a contact + name the engagement. The full
// 6-section spec form opens after creation at /pm/quotes/:id/edit.
export default function QuoteNewPage() {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState([]);
  const [contactId, setContactId] = useState('');
  const [stage, setStage] = useState('stage_1_estimate');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Path-A bill analysis prefill — fetched whenever contactId changes.
  const [billAnalysis, setBillAnalysis] = useState(null);   // { analysis_id, bills_prefill, ... }
  const [billAnalysisLoading, setBillAnalysisLoading] = useState(false);

  useEffect(() => {
    // Reuse existing contacts list (read-only). Same source as ProjectNewPage.
    api.get('/leads')
      .then(r => setContacts(Array.isArray(r.data) ? r.data : (r.data?.data || [])))
      .catch(() => setContacts([]));
  }, []);

  // When contact changes, check if they have a parsed bill on file.
  useEffect(() => {
    if (!contactId) { setBillAnalysis(null); return; }
    let cancelled = false;
    setBillAnalysisLoading(true);
    pmContactsAPI.latestBillAnalysis(contactId)
      .then(r => {
        if (cancelled) return;
        // 204 = no analyses (body undefined); 200 = present
        setBillAnalysis(r.status === 200 ? r.data : null);
        setBillAnalysisLoading(false);
      })
      .catch(() => {
        if (!cancelled) { setBillAnalysis(null); setBillAnalysisLoading(false); }
      });
    return () => { cancelled = true; };
  }, [contactId]);

  async function submit(e) {
    e.preventDefault();
    if (!contactId) { setError('Pick a contact first.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const c = contacts.find(c => c.id === contactId);
      const spec = emptySpec({ name: c?.name, email: c?.email, phone: c?.phone });
      // Prefill address from contact if present — saves the rep typing it twice.
      if (c?.street)   spec.customer.address.street   = c.street;
      if (c?.suburb)   spec.customer.address.suburb   = c.suburb;
      if (c?.city)     spec.customer.address.city     = c.city;
      if (c?.postcode) spec.customer.address.postcode = c.postcode;
      // P5 Path A: overlay bill-analysis numbers onto the placeholder bills.
      if (billAnalysis?.bills_prefill) {
        const p = billAnalysis.bills_prefill;
        spec.bills.manual_entry = {
          ...spec.bills.manual_entry,
          ...Object.fromEntries(
            Object.entries(p).filter(([, v]) => v !== null && v !== undefined && v !== '')
          ),
        };
      }
      // P5 — A1: region + postcode from bill analysis (only when contact didn't already have them)
      if (billAnalysis?.address_prefill) {
        const a = billAnalysis.address_prefill;
        if (a.region && !c?.region)     spec.customer.address.region   = a.region;
        if (a.postcode && !c?.postcode) spec.customer.address.postcode = a.postcode;
      }
      // P5 — Option 3: auto-size system from bill-analysis recommendation
      let autoSize = null;
      if (billAnalysis?.system_recommendation?.recommended_system_kw) {
        autoSize = autoSizeSystem(billAnalysis.system_recommendation);
        if (autoSize) {
          spec.system.panel.count = autoSize.panel_count;
          spec.system.string_topology = autoSize.string_topology;
          spec.system.string_design = {
            panels_per_string: autoSize.panels_per_string,
            string_count: autoSize.string_count,
          };
          if (autoSize.include_battery) {
            spec.system.battery = {
              sku: spec.system.battery?.sku || 'BYD-BAT-276-HVM',
              module_count: autoSize.battery_module_count,
            };
          } else {
            spec.system.battery = null;
          }
          // Record the source for the System tab inline note (engine ignores it)
          spec.system.__auto_sized_from_bill_analysis_id = billAnalysis.analysis_id;
          spec.system.__auto_size_note = autoSize.note;
        }
      }
      spec.pricing.stage = stage;

      // P4.5 — Multi-tier default: every new Stage-1 quote opens with 3 tiers.
      // Tier configs come from the bill-analysis recommendation when present,
      // or from the auto-sized base spec otherwise. Rep edits in the form.
      const tiers = billAnalysis?.system_recommendation?.recommended_system_kw
        ? autoSizeThreeTiers(billAnalysis.system_recommendation)
        : autoSizeThreeTiersFromSpec(spec);
      if (tiers) {
        spec.tiers = tiers;
        // Sync each tier's pricing.stage to match the quote's stage.
        for (const t of spec.tiers) t.pricing.stage = stage;
      }

      const r = await pmQuotesAPI.create({
        contact_id: contactId,
        spec,
        stage,
        bill_analysis_id: billAnalysis?.analysis_id || null,   // links Quote.bill_analysis_id
      });
      navigate(`/pm/quotes/${r.data.quote.id}/edit`);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link to="/pm/quotes" className="text-sm text-slate-500 hover:text-slate-800">← back to quotes</Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">New quote</h1>
        <p className="text-sm text-slate-500 mt-1">
          Pick a contact and an opening stage. The full spec opens on the next screen — engine pre-fills
          a reasonable starting point you can override.
        </p>
      </div>

      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Customer (contact)</span>
          <span className="block text-xs text-slate-500 mt-0.5">Read-only — pulled from your existing contacts/leads.</span>
          <select value={contactId} onChange={e => setContactId(e.target.value)} required
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white
                             focus:outline-none focus:ring-2 focus:ring-amber-500">
            <option value="">— Select contact —</option>
            {contacts.map(c => (
              <option key={c.id} value={c.id}>
                {c.name || '(no name)'} {c.email ? ` · ${c.email}` : ''}
              </option>
            ))}
          </select>
          {contacts.length === 0 && (
            <p className="text-xs text-rose-600 mt-1">
              No contacts found. Add a contact via the existing CRM flow first.
            </p>
          )}
        </label>

        {/* Bill source banner — informs rep what'll be prefilled into the Bills tab */}
        {contactId && (
          <div className="rounded-md border p-3 text-xs"
               style={{ borderColor: billAnalysis ? '#a7f3d0' : '#fde68a',
                        background:   billAnalysis ? '#ecfdf5' : '#fffbeb',
                        color:        billAnalysis ? '#065f46' : '#92400e' }}>
            {billAnalysisLoading && <span>Checking for parsed bill on file…</span>}
            {!billAnalysisLoading && billAnalysis && (
              <div>
                <div className="font-semibold mb-1">
                  ✓ Bill analysis on file — will be auto-prefilled
                </div>
                <div className="leading-relaxed">
                  <b>{Math.round(billAnalysis.bills_prefill.annual_kwh).toLocaleString()} kWh</b> /
                  <b> ${Math.round(billAnalysis.bills_prefill.annual_spend).toLocaleString()}</b> /
                  retailer <b>{billAnalysis.retailer || '—'}</b>
                  {billAnalysis.months_covered ? ` · ${billAnalysis.months_covered} months covered` : ''}
                  {billAnalysis.analysed_at ? ` · analysed ${new Date(billAnalysis.analysed_at).toLocaleDateString('en-NZ')}` : ''}
                </div>

                {/* P5 — address + system sizing call-outs */}
                <div className="mt-2 pt-2 border-t border-emerald-200">
                  <div className="font-medium text-emerald-800 text-[11px] uppercase tracking-wide">Also being prefilled from the analysis</div>
                  <ul className="mt-1 ml-4 list-disc">
                    {billAnalysis.address_prefill?.region && (
                      <li><b>Region:</b> {billAnalysis.address_prefill.region}</li>
                    )}
                    {billAnalysis.address_prefill?.postcode && (
                      <li><b>Postcode:</b> {billAnalysis.address_prefill.postcode}
                        <span className="text-emerald-700/70"> — street + suburb + city stay manual entry (bill PDFs don't expose those structured).</span>
                      </li>
                    )}
                    {billAnalysis.system_recommendation?.recommended_system_kw && (
                      <li><b>System size:</b> auto-sized to ~<b>{billAnalysis.system_recommendation.recommended_system_kw} kW</b> (analyser's recommendation)
                        {billAnalysis.system_recommendation.recommended_battery_kwh > 0 && (
                          <> + <b>{billAnalysis.system_recommendation.recommended_battery_kwh} kWh battery</b></>
                        )}
                        <span className="text-emerald-700/70"> — adjust on the System tab.</span>
                      </li>
                    )}
                  </ul>
                </div>

                <div className="mt-2 text-emerald-700/70">
                  You can override any value on the form after creating the quote.
                </div>
                <div className="mt-2 pt-2 border-t border-emerald-200 font-semibold text-emerald-800">
                  ☆ Three tiers will be auto-created for the customer to compare:
                  Solar only · Solar + battery (recommended) · Solar + battery + EV-ready.
                </div>
              </div>
            )}
            {!billAnalysisLoading && !billAnalysis && (
              <div>
                <div className="font-semibold mb-1">
                  ⚠ No parsed bill on file for this contact
                </div>
                <div className="leading-relaxed">
                  Bills tab will open with placeholder values you must overwrite from the customer's bill.
                  To auto-populate, upload the customer's PDF bill in the Bill Analyser first —
                  it'll link automatically next time you start a quote for this contact.
                </div>
              </div>
            )}
          </div>
        )}

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Opening stage</span>
          <select value={stage} onChange={e => setStage(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white
                             focus:outline-none focus:ring-2 focus:ring-amber-500">
            <option value="stage_1_estimate">Stage 1 — Initial estimate (no site survey)</option>
            <option value="stage_2_firm">Stage 2 — Firm offer (site surveyed)</option>
          </select>
        </label>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded text-sm text-rose-700">{error}</div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button type="submit" disabled={submitting || !contactId}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 text-white rounded-md text-sm font-medium">
            {submitting ? 'Creating…' : 'Create quote'}
          </button>
          <Link to="/pm/quotes" className="text-sm text-slate-500 hover:text-slate-800">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
