import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { pmQuotesAPI, pmContactsAPI, pmProposalEngineAPI } from '../services/pmQuotesApi';
import { useAuth } from '../../context/AuthContext';

import CustomerSection from '../components/quote-sections/CustomerSection';
import BillsSection from '../components/quote-sections/BillsSection';
import SystemSection from '../components/quote-sections/SystemSection';
import CostsSection from '../components/quote-sections/CostsSection';
import PricingSection from '../components/quote-sections/PricingSection';
import PreferencesSection from '../components/quote-sections/PreferencesSection';
import SiteSurveySection from '../components/quote-sections/SiteSurveySection';
import TierStrip from '../components/TierStrip';
import { autoSizeThreeTiers, autoSizeThreeTiersFromSpec } from '../utils/autoSizeThreeTiers';
import { flattenEngineErrors, refusalFromPreview } from '../utils/engineErrorHints';

// Sections that scope to the active tier (System, Costs, Pricing). All others shared.
const TIER_SCOPED_TABS = new Set(['system', 'costs', 'pricing']);

// Default tab order for stage 1 (estimate) — Site survey hidden until stage 2.
const TABS = [
  { id: 'customer',    label: 'Customer' },
  { id: 'bills',       label: 'Bills' },
  { id: 'system',      label: 'System' },
  { id: 'costs',       label: 'Costs' },
  { id: 'pricing',     label: 'Pricing' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'site_survey', label: 'Site survey', stage2Only: true },
];

// Bug #5 fix — In stage 2 (firm quote) the rep is on-site and fills the survey
// FIRST, then revises the System spec against actual measurements. Reorder so
// site_survey appears between Bills and System for stage 2 only.
const STAGE_2_TAB_ORDER = ['customer', 'bills', 'site_survey', 'system', 'costs', 'pricing', 'preferences'];

function tabsForStage(isStage2) {
  const visible = TABS.filter(t => !t.stage2Only || isStage2);
  if (!isStage2) return visible;
  const byId = Object.fromEntries(visible.map(t => [t.id, t]));
  return STAGE_2_TAB_ORDER.map(id => byId[id]).filter(Boolean);
}

export default function QuoteFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [quote, setQuote] = useState(null);
  const [spec, setSpec] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);    // { engine, scenarios } from server
  const [saveError, setSaveError] = useState(null);       // { error, config_errors[] }
  const [activeTab, setActiveTab] = useState('customer');
  // Active tier persisted in URL (?tier=N) so navigating away + back keeps the
  // user on the same tier. Clamped to [0, tiers.length-1] downstream.
  const [searchParams, setSearchParams] = useSearchParams();
  const initialUrlTier = (() => {
    const n = Number(searchParams.get('tier'));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  })();
  const [activeTierIdx, setActiveTierIdx] = useState(initialUrlTier);
  useEffect(() => {
    setSearchParams(prev => {
      const sp = new URLSearchParams(prev);
      if (String(activeTierIdx) !== sp.get('tier')) {
        sp.set('tier', String(activeTierIdx));
      }
      return sp;
    }, { replace: true });
    // setSearchParams is stable per react-router contract
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTierIdx]);
  // P6 — live preview state
  const [previewResult, setPreviewResult] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  // Option 4c (b) — tier strip recompose state + settings
  const [recomposing, setRecomposing] = useState(false);
  const [tierSettings, setTierSettings] = useState(null);
  // L1 field hints — bill-analysis recommendation feeds the System tab's
  // engine-pick line ("Engine: ~17 panels (8.0 kWp ÷ 475W)"). Null when no
  // analysis on file — hints fall back to range + typical band only.
  const [billRec, setBillRec] = useState(null);

  // Option 4c (b) — fetch tier strip settings once on mount
  useEffect(() => {
    pmProposalEngineAPI.tierSettings()
      .then(r => setTierSettings(r.data))
      .catch(() => {});
  }, []);

  // Load quote + current spec
  useEffect(() => {
    let cancelled = false;
    pmQuotesAPI.get(id)
      .then(r => {
        if (cancelled) return;
        setQuote(r.data.quote);
        setSpec(r.data.current_version?.spec || null);
        setLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        setLoadError(e.response?.data?.error || e.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  // L1 field hints — fetch the latest bill analysis for this contact (if any)
  // so System tab hints can show the engine-derived recommended kWp + battery
  // kWh. Silent on 204 (no analysis on file) and on error (hints just degrade
  // gracefully to range + typical band).
  useEffect(() => {
    if (!quote?.contact_id) return;
    let cancelled = false;
    pmContactsAPI.latestBillAnalysis(quote.contact_id)
      .then(r => {
        if (cancelled || !r?.data) return;
        setBillRec(r.data.system_recommendation || null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [quote?.contact_id]);

  // P6 — Live validation preview: debounce 500ms after spec changes, then
  // hit /preview-validate. Cancels stale requests when the spec changes again
  // while one is in-flight.
  useEffect(() => {
    if (!spec) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setPreviewing(true);
      pmQuotesAPI.previewValidate(spec)
        .then(r => { if (!cancelled) { setPreviewResult(r.data); setPreviewing(false); } })
        .catch(e => {
          if (!cancelled) {
            // Most likely a transient server error — keep last good preview
            setPreviewing(false);
          }
        });
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [spec]);

  if (loading) {
    return <div className="text-sm text-slate-500">Loading quote…</div>;
  }
  if (loadError) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded p-4 text-sm text-rose-700">
        {loadError}
      </div>
    );
  }

  // Convert config_errors list to a map keyed on path for inline display.
  const errorMap = {};
  if (saveError?.config_errors) {
    for (const e of saveError.config_errors) errorMap[e.path] = e.message;
  }

  const isStage2 = spec?.pricing?.stage === 'stage_2_firm';
  const visibleTabs = tabsForStage(isStage2);

  // P6 — Hard-fail count from the latest preview (multi-tier sums across tiers)
  const previewEngine = (previewResult || saveResult)?.engine;
  const hardFailCount = previewEngine
    ? (previewEngine.is_multi_tier
        ? previewEngine.tiers.reduce((n, t) => n + (t.hard_fails?.length || 0), 0)
        : previewEngine.hard_fails?.length || 0)
    : 0;
  const hasBlockers = hardFailCount > 0;
  const saveAnyway = hasBlockers && isAdmin;

  // ── Multi-tier wiring ──────────────────────────────────────────────────
  const isMultiTier = Array.isArray(spec?.tiers) && spec.tiers.length > 0;
  const safeActiveIdx = isMultiTier
    ? Math.min(activeTierIdx, spec.tiers.length - 1)
    : 0;
  const activeTier = isMultiTier ? spec.tiers[safeActiveIdx] : null;
  const isTierScopedTab = isMultiTier && TIER_SCOPED_TABS.has(activeTab);

  // Per the "tiers differ on features, not coverage" hard rule, System tab
  // edits default to propagating across all tiers. Reps can opt out per quote
  // via spec.tier_strip.lock_system_sizing=false (advanced mode).
  const lockSystemSizing = spec?.tier_strip?.lock_system_sizing !== false;
  const setLockSystemSizing = (next) => setSpec(prev => ({
    ...prev,
    tier_strip: { ...(prev.tier_strip || {}), lock_system_sizing: next },
  }));

  // The view spec passed to the section: for shared tabs it's the real spec.
  // For tier-scoped tabs (System / Pricing) it's an "effective" view where
  // system/pricing reflect the active tier's overrides.
  // (Plain const — NOT useMemo — because hooks must run before early returns.)
  const sectionViewSpec = (() => {
    if (!isTierScopedTab || !activeTier) return spec;
    return {
      ...spec,
      system: { ...spec.system, ...(activeTier.system_overrides || {}) },
      pricing: activeTier.pricing || spec.pricing,
      cost_overrides: activeTier.cost_overrides || { labour: [], compliance: [], custom: [] },
    };
  })();

  // Wrapped update fn: shared tabs write to top-level spec; tier-scoped tabs
  // write System/Pricing/cost_overrides to the active tier.
  //
  // System tab + lock_system_sizing=true: the CHANGED top-level system fields
  // (shallow diff between prev and next system objects) propagate to every
  // tier's system_overrides — enforces the "tiers differ on features, not
  // coverage" hard rule. Pricing + cost_overrides remain tier-local.
  const sectionUpdate = (updater) => {
    setSpec(prev => {
      const prevTiers = prev?.tiers || [];
      if (!isTierScopedTab || prevTiers.length === 0) {
        return typeof updater === 'function' ? updater(prev) : updater;
      }
      const prevActive = prevTiers[safeActiveIdx] || {};
      const prevView = {
        ...prev,
        system: { ...prev.system, ...(prevActive.system_overrides || {}) },
        pricing: prevActive.pricing || prev.pricing,
        cost_overrides: prevActive.cost_overrides || { labour: [], compliance: [], custom: [] },
      };
      const next = typeof updater === 'function' ? updater(prevView) : updater;
      const shouldPropagateSystem = activeTab === 'system' && lockSystemSizing;
      const systemDiff = shouldPropagateSystem
        ? shallowDiff(prevView.system || {}, next.system || {})
        : null;
      const newTiers = prevTiers.map((tier, idx) => {
        if (idx === safeActiveIdx) {
          return {
            ...prevActive,
            system_overrides: next.system,
            pricing: next.pricing,
            cost_overrides: next.cost_overrides || prevActive.cost_overrides,
          };
        }
        if (systemDiff && Object.keys(systemDiff).length > 0) {
          return {
            ...tier,
            system_overrides: { ...(tier.system_overrides || {}), ...systemDiff },
          };
        }
        return tier;
      });
      return { ...prev, tiers: newTiers };
    });
  };

  // Shallow diff of two objects — returns only the keys whose JSON-stringified
  // values differ. Used to propagate just-changed System fields across tiers
  // when lock_system_sizing is on, without clobbering tier-specific overrides
  // for unchanged fields (battery, wattpilot_included, etc).
  function shallowDiff(prev, next) {
    const out = {};
    const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
    for (const k of keys) {
      if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) {
        out[k] = next[k];
      }
    }
    return out;
  }

  // Tier strip actions
  function handleTierRename(idx, newLabel) {
    setSpec(prev => {
      const tiers = [...prev.tiers];
      tiers[idx] = { ...tiers[idx], label: newLabel };
      return { ...prev, tiers };
    });
  }
  function handleTierMarkRec(idx) {
    setSpec(prev => {
      const tiers = prev.tiers.map((t, i) => ({ ...t, is_recommended: i === idx }));
      return { ...prev, tiers };
    });
  }
  function handleTierAdd() {
    setSpec(prev => {
      if (prev.tiers && prev.tiers.length >= 3) return prev;
      const existing = prev.tiers || [];
      const newTier = existing.length > 0
        ? { ...JSON.parse(JSON.stringify(existing[existing.length - 1])),
            label: 'New tier', is_recommended: false }
        : autoSizeThreeTiersFromSpec(prev)?.[1];
      return { ...prev, tiers: [...existing, newTier] };
    });
    setActiveTierIdx(spec.tiers?.length || 0);
  }
  // Option 4c (b) — size mode toggle (re-runs compose for all 3 tiers)
  async function handleSizeModeChange(newMode) {
    if (newMode === (spec?.tier_strip?.size_mode || 'same_size')) return;
    // Update mode immediately + recompose all 3 tiers from bill analysis
    setSpec(prev => ({ ...prev, tier_strip: { ...(prev.tier_strip || {}), size_mode: newMode } }));
    await recomposeTiers(newMode);
  }

  async function recomposeTiers(forceMode) {
    if (!quote?.contact_id) return;
    setRecomposing(true);
    try {
      const billResp = await pmContactsAPI.latestBillAnalysis(quote.contact_id);
      const billRec = billResp?.data?.system_recommendation;
      const billAnalysisId = billResp?.data?.analysis_id;
      const phase = Number(spec?.system?.phase) || 1;
      const sizeMode = forceMode || spec?.tier_strip?.size_mode || 'same_size';
      const region = billResp?.data?.address_prefill?.region
                  || spec?.customer?.address?.region;
      // Server-side compose with full fallback support — never returns null SKUs.
      const newTiers = await autoSizeThreeTiers({
        billAnalysisId,
        billAnalysis: billRec,
        phase, sizeMode, region,
      });
      setSpec(prev => ({
        ...prev,
        tiers: newTiers,
        tier_strip: { ...(prev.tier_strip || {}), size_mode: sizeMode },
      }));
    } catch (e) {
      console.warn('Recompose tiers failed:', e?.message);
    } finally {
      setRecomposing(false);
    }
  }

  const canRecompose = !!quote?.contact_id;

  function handleTierDelete(idx) {
    setSpec(prev => {
      if (!prev.tiers || prev.tiers.length <= 1) {
        // Last tier — revert to single-tier mode (engine handles both)
        const remaining = (prev.tiers || []).filter((_, i) => i !== idx);
        if (remaining.length === 0) {
          const { tiers, ...rest } = prev;
          return rest;
        }
        return { ...prev, tiers: remaining };
      }
      const tiers = prev.tiers.filter((_, i) => i !== idx);
      // If we deleted the recommended tier, mark the first one as recommended
      if (!tiers.some(t => t.is_recommended)) {
        tiers[0] = { ...tiers[0], is_recommended: true };
      }
      return { ...prev, tiers };
    });
    setActiveTierIdx(prev => Math.max(0, Math.min(prev, idx - 1)));
  }

  async function handleSave(adminOverrideReason = null) {
    setSaving(true);
    setSaveError(null);
    setSaveResult(null);
    try {
      // If admin is saving with hard fails, stamp the reason into the spec
      // so the server's audit_log captures why.
      const specToSend = adminOverrideReason
        ? { ...spec, __admin_override_reason: adminOverrideReason }
        : spec;
      const r = await pmQuotesAPI.patchSpec(id, specToSend);
      setSaveResult(r.data);
      // Refresh quote header (status may have changed back to draft)
      const q = await pmQuotesAPI.get(id);
      setQuote(q.data.quote);
    } catch (e) {
      const data = e.response?.data;
      setSaveError(data || { error: e.message });
    } finally {
      setSaving(false);
    }
  }

  const SectionComponent =
    activeTab === 'customer'    ? CustomerSection
  : activeTab === 'bills'       ? BillsSection
  : activeTab === 'system'      ? SystemSection
  : activeTab === 'costs'       ? CostsSection
  : activeTab === 'pricing'     ? PricingSection
  : activeTab === 'preferences' ? PreferencesSection
  : activeTab === 'site_survey' ? SiteSurveySection
  : null;

  return (
    <div>
      <div className="mb-6">
        <Link to="/pm/quotes" className="text-sm text-slate-500 hover:text-slate-800">← back to quotes</Link>
        <div className="mt-2 flex items-baseline justify-between">
          <h1 className="text-2xl font-bold text-slate-900 font-mono">{quote.quote_ref}</h1>
          <div className="text-sm text-slate-500">
            v{quote.current_version_number} · {quote.status.replace(/_/g, ' ')}
          </div>
        </div>
        <p className="text-sm text-slate-500 mt-1">
          Edit any section, then Save. Saving updates this draft in place and runs the engine.
          A new version is created only when you click <b>Generate PDF</b> on a version the customer has already seen.
          The Validation panel on the right shows the result.
        </p>
      </div>

      {/* Multi-tier strip (only when spec.tiers is populated) */}
      {isMultiTier && (
        <TierStrip
          tiers={spec.tiers}
          activeIndex={safeActiveIdx}
          stage={spec.pricing?.stage}
          sizeMode={spec.tier_strip?.size_mode || 'same_size'}
          canRecompose={canRecompose}
          recomposing={recomposing}
          tierEngineCosts={(() => {
            const eng = (previewResult || saveResult)?.engine;
            if (!eng?.is_multi_tier) return [];
            return (eng.tiers || []).map(t => t?.cost || null);
          })()}
          onPickActive={setActiveTierIdx}
          onRename={handleTierRename}
          onMarkRec={handleTierMarkRec}
          onAdd={handleTierAdd}
          onDelete={handleTierDelete}
          onSizeModeChange={handleSizeModeChange}
          onRecompose={() => recomposeTiers()}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Form area */}
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          {/* Active-tier context banner (only when editing tier-scoped tab) */}
          {isTierScopedTab && activeTier && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Editing the <b>{activeTab}</b> for tier
              {' '}<b>"{activeTier.label}"</b>{activeTier.is_recommended && ' ★'}.
              {activeTab === 'system' ? (
                <label className="ml-3 inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={lockSystemSizing}
                    onChange={e => setLockSystemSizing(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                  />
                  <span>Apply changes to all tiers</span>
                  <span className="text-amber-700/70">— tiers should differ on features, not coverage</span>
                </label>
              ) : (
                <> Changes only apply to this tier. To change shared fields
                  (Customer, Bills, Preferences, Site survey), switch to those tabs.</>
              )}
            </div>
          )}

          {/* Tabs */}
          <div className="flex flex-wrap gap-1 mb-6 border-b border-slate-200 -mx-6 px-6">
            {visibleTabs.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={
                  'px-4 py-2 text-sm font-medium border-b-2 transition-colors ' +
                  (activeTab === t.id
                    ? 'border-amber-500 text-amber-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800')
                }>
                {t.label}
              </button>
            ))}
          </div>

          {/* Coverage-drift warning — flags when tier panel counts diverge enough
              that the tiers are effectively offering different system SIZES
              rather than different feature bundles. Triggers when max-min > 3
              panels (~1.5 kWp at 500W). Per the "tiers differ on features, not
              coverage" hard rule, this almost always wants equalisation. */}
          {isTierScopedTab && activeTab === 'system' && (() => {
            const counts = (spec.tiers || []).map(t =>
              Number(t.system_overrides?.panel?.count) || 0);
            const max = Math.max(...counts), min = Math.min(...counts);
            if (max - min <= 3) return null;
            const recIdx = (spec.tiers || []).findIndex(t => t.is_recommended);
            const targetCount = counts[recIdx >= 0 ? recIdx : 0];
            const equalize = () => setSpec(prev => ({
              ...prev,
              tiers: (prev.tiers || []).map(t => ({
                ...t,
                system_overrides: {
                  ...(t.system_overrides || {}),
                  panel: { ...(t.system_overrides?.panel || {}), count: targetCount },
                },
              })),
            }));
            return (
              <div className="mb-4 rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-900 flex items-center justify-between gap-3">
                <div>
                  <b>Panel count drift across tiers:</b> {counts.join(' / ')} panels (Δ {max - min}).
                  Policy: tiers should differ on <b>features</b> (battery / backup / EV-ready),
                  not on <b>coverage</b>. Match all tiers to the recommended tier's size?
                </div>
                <button
                  type="button"
                  onClick={equalize}
                  className="px-2.5 py-1 rounded bg-yellow-200 hover:bg-yellow-300 text-yellow-900 font-semibold whitespace-nowrap">
                  Equalize to {targetCount}
                </button>
              </div>
            );
          })()}

          {/* Active section — engineSnapshot prefers live preview over last-saved.
              billRecommendation feeds System tab L1 hints with engine-derived
              recommended kWp / battery kWh from the latest bill analysis.
              costSnapshot is the active tier's cost block (or root cost for
              single-tier) — fixes the multi-tier margin display path and powers
              Pricing tab L1 hints. */}
          {SectionComponent && (
            <SectionComponent
              spec={sectionViewSpec}
              update={sectionUpdate}
              errors={errorMap}
              engineSnapshot={previewResult || saveResult}
              billRecommendation={billRec}
              costSnapshot={(() => {
                const eng = (previewResult || saveResult)?.engine;
                if (!eng) return null;
                if (eng.is_multi_tier) return eng.tiers?.[safeActiveIdx]?.cost || null;
                return eng.cost || null;
              })()}
              quote={quote}
              // Bug #2a — discount workflow only on the recommended tier in
              // multi-tier mode. Single-tier always allows it.
              discountAllowed={!isMultiTier || !!activeTier?.is_recommended}
            />
          )}

          {/* Section nav buttons */}
          <div className="mt-8 pt-6 border-t border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {visibleTabs.findIndex(t => t.id === activeTab) > 0 && (
                <button onClick={() => {
                  const i = visibleTabs.findIndex(t => t.id === activeTab);
                  setActiveTab(visibleTabs[i - 1].id);
                }}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900">← Previous</button>
              )}
              {visibleTabs.findIndex(t => t.id === activeTab) < visibleTabs.length - 1 && (
                <button onClick={() => {
                  const i = visibleTabs.findIndex(t => t.id === activeTab);
                  setActiveTab(visibleTabs[i + 1].id);
                }}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900">Next →</button>
              )}
            </div>
            <SaveButton
              saving={saving}
              hasBlockers={hasBlockers}
              hardFailCount={hardFailCount}
              isAdmin={isAdmin}
              onSave={handleSave}
              onSaveAnyway={(reason) => handleSave(reason)}
            />
          </div>
        </div>

        {/* Validation panel */}
        <div className="space-y-4">
          {(() => {
            // Show refusal info from save OR from live preview (whichever
            // is current). Save errors always win — they're a deliberate
            // user action. Preview-time errors appear quietly as the rep types.
            const refusal = saveError || refusalFromPreview(previewResult);
            if (!refusal) return null;
            const flat = flattenEngineErrors(refusal);
            const grouped = flat.reduce((acc, e) => {
              const key = e.tierLabel || '_root';
              (acc[key] = acc[key] || []).push(e);
              return acc;
            }, {});
            const groupKeys = Object.keys(grouped);
            return (
              <div className="bg-rose-50 border border-rose-200 rounded-lg p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-rose-800">
                    {saveError ? 'Engine refused this spec on save' : 'Live: engine refusing this spec'}
                  </h3>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 whitespace-nowrap">
                    {flat.length} issue{flat.length === 1 ? '' : 's'}
                  </span>
                </div>
                {refusal.error && (
                  <p className="text-xs text-rose-700 mt-1">{refusal.error}</p>
                )}
                {flat.length === 0 && (
                  <p className="text-xs text-rose-700 mt-2 italic">No structured error detail — check the server log.</p>
                )}
                {groupKeys.map(group => (
                  <div key={group} className="mt-3">
                    {group !== '_root' && (
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-rose-900 mb-1">
                        Tier: {group}
                      </div>
                    )}
                    <ul className="space-y-2">
                      {grouped[group].map((e, i) => (
                        <li key={i} className="bg-white border border-rose-200 rounded p-2 text-xs">
                          <div className="flex items-start gap-2">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${
                              e.kind === 'config' ? 'bg-amber-100 text-amber-800'
                              : e.kind === 'bom'  ? 'bg-orange-100 text-orange-800'
                                                  : 'bg-rose-100 text-rose-800'
                            }`}>
                              {e.kind === 'config' ? 'CONFIG' : e.kind === 'bom' ? 'BOM' : 'COST'}
                            </span>
                            <div className="flex-1 min-w-0">
                              {e.path && (
                                <div className="font-mono text-[11px] text-slate-700">{e.path}</div>
                              )}
                              <div className="text-rose-800">{e.message}</div>
                              {e.hint && (
                                <div className="mt-1 text-slate-700">
                                  <span className="font-semibold text-emerald-700">How to fix: </span>
                                  {e.hint}
                                </div>
                              )}
                              {e.tab && e.tab !== activeTab && (
                                <button
                                  type="button"
                                  onClick={() => setActiveTab(e.tab)}
                                  className="mt-1 text-[11px] text-blue-700 hover:underline"
                                >
                                  → Open {e.tabLabel} tab
                                </button>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Live preview takes precedence; the latest save result is just the
              persisted baseline. Engine result shape is identical. */}
          {(() => {
            const live = previewResult || saveResult;
            if (!live) return null;
            return live.engine?.is_multi_tier
              ? <MultiTierValidationPanel saveResult={live} previewing={previewing} />
              : <SingleTierValidationPanel saveResult={live} previewing={previewing} />;
          })()}

          {!saveResult && !saveError && (
            <div className="bg-white border border-slate-200 rounded-lg p-4 text-xs text-slate-500">
              Save changes to run the engine and see scenarios, margin status, and any hard-fail
              reasons in this panel.
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-2">Quote lifecycle</h3>
            <p className="text-xs text-slate-500 mb-3">
              Open the detail page to generate the customer PDF + sales console,
              share the quote with the customer, capture their signature, and
              record the deposit.
            </p>
            <Link to={`/pm/quotes/${id}`}
                  className="inline-block px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-medium">
              Open detail page →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Live preview badge (P6) ────────────────────────────────────────────────
function LiveBadge({ previewing }) {
  return previewing ? (
    <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
      Live · checking
    </span>
  ) : (
    <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
      Live
    </span>
  );
}

// ── Save button with hard-fail gating + admin override (P6) ───────────────
function SaveButton({ saving, hasBlockers, hardFailCount, isAdmin, onSave, onSaveAnyway }) {
  const [overrideMode, setOverrideMode] = useState(false);
  const [reason, setReason] = useState('');

  if (saving) {
    return (
      <button disabled
              className="px-4 py-2 bg-slate-300 text-white rounded-md text-sm font-medium">
        Saving…
      </button>
    );
  }

  if (!hasBlockers) {
    return (
      <button onClick={() => onSave()}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-md text-sm font-medium">
        Save changes
      </button>
    );
  }

  // Hard fails present. Rep-only: blocked. Admin: gets override flow.
  if (!isAdmin) {
    return (
      <button disabled
              title={`Fix ${hardFailCount} hard fail${hardFailCount > 1 ? 's' : ''} first, or ask an admin to override`}
              className="px-4 py-2 bg-slate-300 text-slate-500 rounded-md text-sm font-medium cursor-not-allowed">
        Save blocked ({hardFailCount} hard fail{hardFailCount > 1 ? 's' : ''})
      </button>
    );
  }

  // Admin override
  if (!overrideMode) {
    return (
      <button onClick={() => setOverrideMode(true)}
              className="px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white rounded-md text-sm font-medium">
        Save anyway (admin) · {hardFailCount} hard fail{hardFailCount > 1 ? 's' : ''}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 max-w-sm">
      <textarea
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Why is the override OK? (min 10 chars — audit-logged)"
        rows={2}
        className="border border-rose-300 rounded p-2 text-xs focus:border-rose-500 focus:ring-2 focus:ring-rose-200 outline-none"
      />
      <div className="flex gap-2">
        <button
          onClick={() => { setOverrideMode(false); setReason(''); }}
          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs">
          Cancel
        </button>
        <button
          onClick={() => { onSaveAnyway(reason.trim()); setOverrideMode(false); setReason(''); }}
          disabled={reason.trim().length < 10}
          className="px-3 py-1.5 bg-rose-500 hover:bg-rose-600 disabled:bg-slate-300 text-white rounded text-xs font-medium">
          Confirm override
        </button>
      </div>
    </div>
  );
}

// ── Single-tier validation panel (legacy) ──────────────────────────────────
function SingleTierValidationPanel({ saveResult, previewing }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Validation result</h3>
        <LiveBadge previewing={previewing} />
      </div>

      <div className={
        'p-3 rounded text-sm font-medium ' +
        (saveResult.engine?.can_ship === true
          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
          : 'bg-rose-50 text-rose-700 border border-rose-200')
      }>
        {saveResult.engine?.can_ship
          ? '✓ Can ship — ready to generate.'
          : '✗ Cannot ship — see block reasons below.'}
      </div>

      {saveResult.engine?.margin_floor_status && (
        <div className="text-xs">
          <span className="text-slate-500">Margin floor:</span>{' '}
          <span className={
            saveResult.engine.margin_floor_status === 'healthy' ? 'text-emerald-700 font-semibold'
            : saveResult.engine.margin_floor_status === 'amber' ? 'text-amber-700 font-semibold'
            : 'text-rose-700 font-semibold'
          }>
            {saveResult.engine.margin_floor_status.toUpperCase()}
          </span>
        </div>
      )}

      {saveResult.engine?.block_reasons?.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-rose-700 mb-1">Block reasons</h4>
          <ul className="space-y-1 text-xs text-rose-700">
            {saveResult.engine.block_reasons.map((r, i) => <li key={i}>• {r}</li>)}
          </ul>
        </div>
      )}

      {saveResult.scenarios && (
        <div>
          <h4 className="text-xs font-semibold text-slate-700 mb-2">Three-scenario summary</h4>
          <div className="space-y-1.5 text-xs">
            {saveResult.scenarios.map(s => (
              <div key={s.key} className={
                'flex items-center justify-between px-2 py-1.5 rounded ' +
                (s.key === 'expected' ? 'bg-amber-50 font-semibold' : 'bg-slate-50')
              }>
                <span className="text-slate-700">{s.label}</span>
                <span className="text-slate-900">
                  ${Math.round(s.lifetime_net_savings).toLocaleString()} · {s.payback_yrs}y · {s.irr_pct}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Multi-tier validation panel (P4.5c) ────────────────────────────────────
// Per-tier rows: each shows can_ship + margin + Expected savings.
// Headline (recommended) tier highlighted.
function MultiTierValidationPanel({ saveResult, previewing }) {
  const eng = saveResult.engine;
  const tiers = eng.tiers || [];
  const tierScenarios = saveResult.tier_scenarios || [];   // array aligned to tiers
  const blockReasons = eng.block_reasons || [];

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Validation result · {tiers.length} tiers</h3>
        <LiveBadge previewing={previewing} />
      </div>

      <div className={
        'p-3 rounded text-sm font-medium ' +
        (eng.can_ship_all
          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
          : 'bg-rose-50 text-rose-700 border border-rose-200')
      }>
        {eng.can_ship_all
          ? `✓ All ${tiers.length} tiers can ship.`
          : `✗ ${tiers.filter(t => !t.can_ship).length}/${tiers.length} tier(s) blocked.`}
      </div>

      {/* Per-tier rows */}
      <div className="space-y-2">
        {tiers.map((t, i) => {
          const scs = tierScenarios[i] || [];
          const expected = scs.find?.(s => s.key === 'expected');
          const margin = typeof t.margin_pct === 'number' ? `${t.margin_pct.toFixed(1)}%` : '—';
          const floor = t.margin_floor_status || 'unknown';
          const floorClass =
            floor === 'healthy'      ? 'text-emerald-700' :
            floor === 'amber'        ? 'text-amber-700' :
            floor === 'below_floor'  ? 'text-rose-700' :
                                       'text-slate-500';
          return (
            <div
              key={t.tier_id || i}
              className={
                'rounded border p-2.5 ' +
                (t.is_recommended
                  ? 'border-amber-300 bg-amber-50/50'
                  : 'border-slate-200 bg-slate-50/40')
              }>
              <div className="flex items-baseline justify-between">
                <div className="text-xs font-semibold text-slate-900 truncate flex-1">
                  {t.is_recommended && <span className="text-amber-600 mr-1">★</span>}
                  {t.label}
                </div>
                <div className="text-[11px] font-mono">
                  {t.can_ship
                    ? <span className="text-emerald-700">✓ ship</span>
                    : <span className="text-rose-700">✗ blocked</span>}
                </div>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                {/* Phase D2 — margin breakdown: list / cost / profit / % */}
                {t.cost?.totals && <>
                  <span className="text-slate-500">List price</span>
                  <span className="text-right text-slate-700 font-mono">
                    ${Math.round(t.cost.totals.total_list_inc_gst || 0).toLocaleString()}
                  </span>
                  <span className="text-slate-500">Build cost</span>
                  <span className="text-right text-slate-700 font-mono">
                    ${Math.round((t.cost.totals.total_cost_ex_gst || 0) * 1.15).toLocaleString()}
                  </span>
                  <span className="text-slate-500">Margin $</span>
                  <span className={`text-right font-mono ${floorClass}`}>
                    ${Math.round(t.cost.totals.profit_inc_gst || 0).toLocaleString()}
                  </span>
                </>}
                <span className="text-slate-500">Margin %</span>
                <span className={`text-right ${floorClass} font-semibold`}>{margin} · {floor}</span>
                {expected && <>
                  <span className="text-slate-500">Yr1 save</span>
                  <span className="text-right text-slate-700">
                    ${Math.round(expected.yr1_savings).toLocaleString()}
                  </span>
                  <span className="text-slate-500">25-yr (Expected)</span>
                  <span className="text-right text-slate-700">
                    ${Math.round(expected.lifetime_net_savings).toLocaleString()}
                  </span>
                  <span className="text-slate-500">Payback</span>
                  <span className="text-right text-slate-700">{expected.payback_yrs} yrs</span>
                </>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Aggregated block reasons (engine prefixes each with [Tier Label]) */}
      {blockReasons.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-rose-700 mb-1">Block reasons</h4>
          <ul className="space-y-1 text-xs text-rose-700">
            {blockReasons.map((r, i) => <li key={i}>• {r}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
