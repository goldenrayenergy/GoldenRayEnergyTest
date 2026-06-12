import { useState } from 'react';
import { Field, TextInput, NumberInput, Select, SectionGrid, SectionHeading, CheckBox } from './_shared';
import { REFERENCE, pmProposalEngineAPI } from '../../services/pmQuotesApi';
import useCatalogueOptions from '../../hooks/useCatalogueOptions';

export default function SystemSection({ spec, update, errors = {} }) {
  const sys = spec.system || {};
  const setSys = (key, val) => update(s => ({ ...s, system: { ...s.system, [key]: val } }));
  const setSub = (parent, key, val) => update(s => ({
    ...s,
    system: { ...s.system, [parent]: { ...(s.system?.[parent] || {}), [key]: val } },
  }));

  // Live catalogue from Supabase (with field aliasing applied).
  // Falls back to the hardcoded REFERENCE if the fetch hasn't completed yet
  // OR if the API errors out — UI never crashes from a missing dropdown.
  const { options: live, loading: liveLoading } = useCatalogueOptions();
  const panelOpts    = (live.panels && live.panels.length)         ? live.panels         : REFERENCE.panels;
  const inverterOpts = (live.inverters && live.inverters.length)   ? live.inverters      : REFERENCE.inverters;
  const batteryOpts  = (live.batteries && live.batteries.length)   ? live.batteries      : REFERENCE.batteries;
  const meterOpts    = (live.smart_meters && live.smart_meters.length) ? live.smart_meters : REFERENCE.smartMeters;

  // Watts: prefer the live catalogue entry (has the real product spec watts).
  const panel = panelOpts.find(p => p.sku === sys.panel?.sku);
  const panelWatts = panel?.watts
    || (panel?.sku === 'PHN-PNL-595-DRACO' ? 595
        : panel?.sku === 'PHN-PNL-595-DRC' ? 595
        : panel?.sku === 'PHN-PNL-475-QSR' ? 475 : 0);
  const systemKw = sys.panel?.count && panelWatts ? (sys.panel.count * panelWatts / 1000).toFixed(2) : '—';

  const battery = batteryOpts.find(b => b.sku === sys.battery?.sku);
  const moduleKwh = battery?.kwh_per_module || battery?.module_kwh || 2.76;
  const batteryKwh = battery && sys.battery?.module_count
    ? (moduleKwh * sys.battery.module_count).toFixed(2) : 0;

  const hasBattery = !!sys.battery?.sku;

  // String design consistency
  const stringTotal = (sys.string_design?.panels_per_string || 0) * (sys.string_design?.string_count || 0);
  const stringMismatch = sys.panel?.count && stringTotal && stringTotal !== sys.panel?.count;

  const autoSizeNote = sys.__auto_size_note;

  // Option 4b — engine-recommended panel (highest-wattage with full specs)
  const [panRecState, setPanRecState] = useState({ loading: false, error: null, result: null });

  const runRecommendPanel = async () => {
    setPanRecState({ loading: true, error: null, result: null });
    try {
      const { data } = await pmProposalEngineAPI.recommendPanel({
        target_kwp: sys.panel?.count && panelWatts ? (sys.panel.count * panelWatts / 1000) : null,
      });
      setPanRecState({ loading: false, error: null, result: data });
      if (data.sku && data.reason_code === 'selected') {
        update(s => ({
          ...s,
          system: { ...s.system, panel: { ...(s.system?.panel || {}), sku: data.sku } },
        }));
      }
    } catch (e) {
      setPanRecState({ loading: false, error: e.response?.data?.error || e.message, result: null });
    }
  };

  // Option 4b — engine-recommended battery (§3.1 decision tree)
  const [batRecState, setBatRecState] = useState({ loading: false, error: null, result: null });
  const canRecommendBattery = !!(sys.inverter?.sku && hasBattery);

  const runRecommendBattery = async () => {
    setBatRecState({ loading: true, error: null, result: null });
    try {
      // Pull target_usable_kwh from spec; rep should have entered it via
      // the Module count field OR via bill-analysis auto-fill. If neither
      // is set, default to current battery capacity for re-evaluation.
      const targetUsableKwh = sys.battery?.target_usable_kwh
        || (sys.battery?.module_count ? sys.battery.module_count * moduleKwh : 10);
      const { data } = await pmProposalEngineAPI.recommendBattery({
        inverter_sku: sys.inverter.sku,
        target_usable_kwh: targetUsableKwh,
      });
      setBatRecState({ loading: false, error: null, result: data });
      if (data.sku && data.reason_code === 'selected') {
        update(s => ({
          ...s,
          system: {
            ...s.system,
            battery: {
              ...(s.system?.battery || {}),
              sku: data.sku,
              module_count: data.module_count,
            },
          },
        }));
      }
    } catch (e) {
      setBatRecState({ loading: false, error: e.response?.data?.error || e.message, result: null });
    }
  };

  // Option 4a — engine-recommended inverter (§2.8 decision tree)
  const [invRecState, setInvRecState] = useState({ loading: false, error: null, result: null });
  const canRecommendInverter = !!(sys.panel?.sku && sys.panel?.count && sys.phase);

  const runRecommendInverter = async () => {
    setInvRecState({ loading: true, error: null, result: null });
    try {
      const { data } = await pmProposalEngineAPI.recommendInverter({
        panel_sku:    sys.panel.sku,
        panel_count:  sys.panel.count,
        phase:        Number(sys.phase),
        has_battery:  hasBattery,
        has_ev:       !!sys.wattpilot_included,
      });
      setInvRecState({ loading: false, error: null, result: data });
      if (data.sku && data.reason_code === 'selected') {
        update(s => ({
          ...s,
          system: {
            ...s.system,
            inverter: { ...(s.system?.inverter || {}), sku: data.sku },
          },
        }));
      }
    } catch (e) {
      setInvRecState({ loading: false, error: e.response?.data?.error || e.message, result: null });
    }
  };

  // Option 2 — engine-recommended string layout (envelope-search algorithm)
  const [recState, setRecState] = useState({ loading: false, error: null, layout: null });
  const canRecommend = !!(sys.panel?.sku && sys.inverter?.sku && sys.panel?.count);

  const runRecommend = async () => {
    setRecState({ loading: true, error: null, layout: null });
    try {
      const { data } = await pmProposalEngineAPI.recommendStringLayout({
        panel_sku:    sys.panel.sku,
        inverter_sku: sys.inverter.sku,
        panel_count:  sys.panel.count,
        region:       spec.customer?.address?.region,
      });
      const layout = data.layout;
      setRecState({ loading: false, error: null, layout });
      // Apply the recommendation to the spec when it's a valid layout.
      if (layout?.reason_code === 'optimal' || layout?.reason_code === 'asymmetric_fallback') {
        update(s => ({
          ...s,
          system: {
            ...s.system,
            string_topology: layout.topology,
            string_design: {
              panels_per_string: layout.panels_per_string,
              string_count:      layout.string_count,
            },
          },
        }));
      }
    } catch (e) {
      setRecState({ loading: false, error: e.response?.data?.error || e.message, layout: null });
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        title="System design"
        subtitle="Hardware selection + topology. Engineering validator checks AS/NZS 5033 Voc / Isc / MPPT current and BMS rules on save." />

      {!liveLoading && live.panels?.length > 0 && (
        <div className="mb-4 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-1.5">
          ✓ Live catalogue from Supabase: {live.panels.length} panels · {live.inverters.length} inverters · {live.batteries.length} batteries · {live.smart_meters.length} smart meters
        </div>
      )}
      {liveLoading && (
        <div className="mb-4 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded px-3 py-1.5">
          Loading catalogue from Supabase…
        </div>
      )}

      {autoSizeNote && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
          <span className="font-semibold mr-1">ℹ Auto-sized from bill analysis</span>
          {autoSizeNote}
        </div>
      )}

      {/* Panels + inverter */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Panels & inverter</h3>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={runRecommendPanel}
              disabled={panRecState.loading}
              className="text-xs px-2.5 py-1 rounded border border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Engine picks the highest-wattage panel with full specs">
              {panRecState.loading ? 'Computing…' : 'Recommend panel'}
            </button>
            <button
              type="button"
              onClick={runRecommendInverter}
              disabled={!canRecommendInverter || invRecState.loading}
              className="text-xs px-2.5 py-1 rounded border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
              title={!canRecommendInverter ? 'Pick panel + count + phase first' : 'Engine picks inverter per §2.8'}>
              {invRecState.loading ? 'Computing…' : 'Recommend inverter'}
            </button>
          </div>
        </div>
        <SectionGrid columns={2}>
          <Field label="Panel model" required>
            <Select value={sys.panel?.sku} onChange={v => setSub('panel', 'sku', v)} options={panelOpts} />
          </Field>
          <Field label="Panel count" required error={errors['system.panel.count']}>
            <NumberInput value={sys.panel?.count} onChange={v => setSub('panel', 'count', v)} placeholder="20" />
          </Field>
          <Field label="System size"
                 hint={`Computed: ${systemKw} kW = ${sys.panel?.count || 0} × ${panelWatts}W`}>
            <input value={`${systemKw} kW`} readOnly
                   className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-md text-sm text-slate-500" />
          </Field>
          <Field label="Inverter" required>
            <Select value={sys.inverter?.sku} onChange={v => setSub('inverter', 'sku', v)}
                    options={inverterOpts} />
          </Field>
        </SectionGrid>
        {panRecState.error && (
          <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800">
            Engine error: {panRecState.error}
          </div>
        )}
        {panRecState.result && (
          <div className={`mt-3 p-3 rounded text-xs border ${
            panRecState.result.reason_code === 'selected' ? 'bg-sky-50 border-sky-200 text-sky-900'
                                                          : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}>
            <div className="font-semibold mb-1">
              Engine recommendation: {panRecState.result.panel?.name || panRecState.result.sku || '(no candidate)'}
            </div>
            <div className="leading-relaxed">{panRecState.result.reason}</div>
            {panRecState.result.alternatives?.length > 0 && (
              <div className="mt-2 opacity-80">
                Alternatives:
                <ul className="list-disc list-inside space-y-0.5 ml-2">
                  {panRecState.result.alternatives.map((alt, i) => (
                    <li key={i}>{alt.name} — {alt.watts}W · ${alt.dollars_per_kwp}/kWp{alt.panels_needed != null && ` · ${alt.panels_needed} panels`}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {invRecState.error && (
          <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800">
            Engine error: {invRecState.error}
          </div>
        )}
        {invRecState.result && (
          <div className={`mt-3 p-3 rounded text-xs border ${
            invRecState.result.reason_code === 'selected'                ? 'bg-emerald-50 border-emerald-200 text-emerald-900' :
            invRecState.result.reason_code === 'dc_ac_undersized'        ? 'bg-amber-50 border-amber-200 text-amber-900' :
            invRecState.result.reason_code === 'dc_ac_out_of_envelope'   ? 'bg-rose-50 border-rose-200 text-rose-900' :
                                                                          'bg-rose-50 border-rose-200 text-rose-900'
          }`}>
            <div className="font-semibold mb-1">
              Engine recommendation: {invRecState.result.inverter?.name || invRecState.result.sku || '(no candidate)'}
            </div>
            <div className="leading-relaxed">{invRecState.result.reason}</div>
            <div className="mt-1 text-[10px] opacity-80">
              Target AC {invRecState.result.target_ac_kw} kW · DC/AC {invRecState.result.dc_ac_ratio} (target {invRecState.result.dc_ac_target})
            </div>
            {invRecState.result.alternatives?.length > 0 && (
              <div className="mt-2 opacity-80">
                Alternatives:
                <ul className="list-disc list-inside space-y-0.5 ml-2">
                  {invRecState.result.alternatives.map((alt, i) => (
                    <li key={i}>{alt.name} — {alt.ac_kw} kW · DC/AC {alt.dc_ac_ratio}{alt.is_plus_variant ? ' · Plus' : ''}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Battery */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Battery (optional)</h3>
          <button
            type="button"
            onClick={runRecommendBattery}
            disabled={!canRecommendBattery || batRecState.loading}
            className="text-xs px-2.5 py-1 rounded border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
            title={!canRecommendBattery ? 'Include battery + pick inverter first' : 'Engine picks battery per §3.1'}>
            {batRecState.loading ? 'Computing…' : 'Recommend battery'}
          </button>
        </div>
        <div className="mb-3">
          <CheckBox checked={hasBattery}
                    onChange={v => {
                      // Option 4c — no hardcoded SKU. Checking "Include battery"
                      // enables the battery section with null SKU + null
                      // module_count; rep clicks "Recommend battery" (engine
                      // picks per §3.1) or picks from dropdown.
                      if (v) setSys('battery', { sku: null, module_count: null });
                      else setSys('battery', null);
                    }}
                    label="Include battery in this quote" />
        </div>
        {hasBattery && (
          <SectionGrid columns={3}>
            <Field label="Battery model" required>
              <Select value={sys.battery?.sku} onChange={v => setSub('battery', 'sku', v)}
                      options={batteryOpts} />
            </Field>
            <Field label="Module count" required
                   hint="BYD HVM 3-8 modules · HVS 2-5 · Reserva 2-5 (4-5 needs 2 BMS)"
                   error={errors['system.battery.module_count']}>
              <NumberInput value={sys.battery?.module_count}
                           onChange={v => setSub('battery', 'module_count', v)} placeholder="5" />
            </Field>
            <Field label="Total usable kWh">
              <input value={`${batteryKwh} kWh`} readOnly
                     className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-md text-sm text-slate-500" />
            </Field>
          </SectionGrid>
        )}
        {hasBattery && sys.inverter?.sku === 'FRN-INV-100-G24-1P' && (
          <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700">
            ⚠ Battery requires <b>GEN24 Plus</b> variant. Switch the inverter above or remove the battery —
            engine will hard-fail save otherwise.
          </div>
        )}
        {batRecState.error && (
          <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800">
            Engine error: {batRecState.error}
          </div>
        )}
        {batRecState.result && (
          <div className={`mt-3 p-3 rounded text-xs border ${
            batRecState.result.reason_code === 'selected' ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                                                           : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}>
            <div className="font-semibold mb-1">
              Engine recommendation: {batRecState.result.battery?.name || batRecState.result.sku || '(no candidate)'}
              {batRecState.result.module_count && ` × ${batRecState.result.module_count} modules`}
            </div>
            <div className="leading-relaxed">{batRecState.result.reason}</div>
            {batRecState.result.total_usable_kwh && (
              <div className="mt-1 text-[10px] opacity-80">
                Target {batRecState.result.target_usable_kwh} kWh · Actual {batRecState.result.total_usable_kwh} kWh usable · ${batRecState.result.dollars_per_usable_kwh}/kWh
              </div>
            )}
            {batRecState.result.alternatives?.length > 0 && (
              <div className="mt-2 opacity-80">
                Alternatives:
                <ul className="list-disc list-inside space-y-0.5 ml-2">
                  {batRecState.result.alternatives.map((alt, i) => (
                    <li key={i}>{alt.name} — {alt.module_count} × {alt.series} = {alt.total_usable_kwh} kWh at ${alt.dollars_per_usable_kwh}/kWh ({alt.headroom_pct}% headroom)</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* String design */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">String topology</h3>
          <button
            type="button"
            onClick={runRecommend}
            disabled={!canRecommend || recState.loading}
            className="text-xs px-2.5 py-1 rounded border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed">
            {recState.loading ? 'Computing…' : 'Recommend layout'}
          </button>
        </div>
        <SectionGrid columns={3}>
          <Field label="Topology" required>
            <Select value={sys.string_topology} onChange={v => setSys('string_topology', v)}
                    options={REFERENCE.topologies} />
          </Field>
          <Field label="Panels per string" required
                 hint="Fronius minimum 4 — Voc-cold-checked vs inverter Uoc max">
            <NumberInput value={sys.string_design?.panels_per_string}
                         onChange={v => setSub('string_design', 'panels_per_string', v)} placeholder="5" />
          </Field>
          <Field label="String count" required
                 hint={`Total = ${sys.string_design?.panels_per_string || 0} × ${sys.string_design?.string_count || 0} = ${stringTotal} panels`}>
            <NumberInput value={sys.string_design?.string_count}
                         onChange={v => setSub('string_design', 'string_count', v)} placeholder="4" />
          </Field>
        </SectionGrid>
        {stringMismatch && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
            ⚠ String design ({stringTotal}) doesn't match panel count ({sys.panel?.count}). Save will fail.
          </div>
        )}
        {recState.error && (
          <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800">
            Engine error: {recState.error}
          </div>
        )}
        {recState.layout && (
          <div className={`mt-3 p-3 rounded text-xs border ${
            recState.layout.reason_code === 'optimal'             ? 'bg-emerald-50 border-emerald-200 text-emerald-900' :
            recState.layout.reason_code === 'asymmetric_fallback' ? 'bg-amber-50 border-amber-200 text-amber-900' :
                                                                    'bg-rose-50 border-rose-200 text-rose-900'
          }`}>
            <div className="font-semibold mb-1">
              Engine recommendation: {recState.layout.string_count} × {recState.layout.panels_per_string}
              {recState.layout.asymmetric_string && ` + 1 × ${recState.layout.asymmetric_string.panels_per_string}`}
              {' '}({recState.layout.topology})
            </div>
            <div className="leading-relaxed">{recState.layout.reason}</div>
            <div className="mt-1 text-[10px] opacity-80">
              Voc cold {recState.layout.string_voc_cold}V · Vmp hot {recState.layout.string_vmp_hot}V
              {recState.layout.mppt_current_per_mppt && ` · MPPT current ${recState.layout.mppt_current_per_mppt}A`}
            </div>
            {recState.layout.violations?.length > 0 && (
              <ul className="mt-2 list-disc list-inside space-y-0.5">
                {recState.layout.violations.map((v, i) => (
                  <li key={i}>{v.message}</li>
                ))}
              </ul>
            )}
            {recState.layout.alternatives?.length > 0 && (
              <div className="mt-2 opacity-80">
                Alternatives:{' '}
                {recState.layout.alternatives.map((a, i) => (
                  <span key={i} className="ml-2">
                    {a.string_count}×{a.panels_per_string} ({a.topology})
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Smart meter + electrical */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Smart meter & electrical</h3>
        <SectionGrid columns={3}>
          <Field label="Smart meter">
            <Select value={sys.smart_meter?.sku}
                    onChange={v => {
                      const m = meterOpts.find(x => x.sku === v);
                      update(s => ({
                        ...s,
                        system: { ...s.system,
                          smart_meter: { sku: v, phase: m?.phase },
                          phase: m?.phase || s.system?.phase,
                        },
                      }));
                    }}
                    options={meterOpts} />
          </Field>
          <Field label="Cable run estimate (m)"
                 hint="Inverter → switchboard. Refined at site survey for Stage 2.">
            <NumberInput value={sys.cable_run_metres_estimate}
                         onChange={v => setSys('cable_run_metres_estimate', v)} placeholder="24" />
          </Field>
          <Field label="House phase"
                 hint="1 = single-phase · 3 = three-phase. Must match smart meter.">
            <NumberInput value={sys.phase} onChange={v => setSys('phase', v)} placeholder="1" />
          </Field>
        </SectionGrid>
      </div>
    </div>
  );
}
