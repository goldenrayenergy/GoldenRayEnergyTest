import { Field, TextInput, NumberInput, Select, SectionGrid, SectionHeading, CheckBox } from './_shared';

// Only rendered for stage_2_firm quotes. Stage 1 has these fields as
// "unverified — confirmed at site survey" so the survey form just collects
// the missing data and unlocks the firm offer.
//
// roofAnalysis (optional): the latest roof_analyses row for this contact,
// fetched by QuoteFormPage from /api/pm/contacts/:id/latest-roof-analysis.
// May be null (no analysis on file / feature off / fetch failed). When
// present, we render a summary panel at the TOP of the section so the
// engineer sees the Google Solar auto-analysis BEFORE confirming manual
// measurements.
export default function SiteSurveySection({ spec, update, roofAnalysis }) {
  const ss = spec.site_survey || {};
  const sw = ss.switchboard || {};
  const setSS = (key, val) => update(s => ({ ...s, site_survey: { ...s.site_survey, [key]: val } }));
  const setSW = (key, val) => update(s => ({
    ...s,
    site_survey: { ...s.site_survey, switchboard: { ...(s.site_survey?.switchboard || {}), [key]: val } },
  }));

  return (
    <div className="space-y-6">
      <RoofAnalysisPanel roofAnalysis={roofAnalysis} />

      <SectionHeading
        title="Site survey (Stage 2)"
        subtitle="Field-measured data that turns the Stage 1 estimate into a firm offer. Only required when stage = Stage 2." />

      <SectionGrid columns={2}>
        <Field label="Cable run measured (m)"
               hint="AC cable inverter → switchboard. Overrides the estimate from the System section.">
          <NumberInput value={ss.cable_run_metres_measured}
                       onChange={v => setSS('cable_run_metres_measured', v)} placeholder="24" />
        </Field>
        <Field label="Roof orientation" hint="Predominant pitch direction (N / NE / E / etc.)">
          <TextInput value={ss.roof_orientation} onChange={v => setSS('roof_orientation', v)} placeholder="N" />
        </Field>
        <Field label="Roof material">
          <Select value={ss.roof_material} onChange={v => setSS('roof_material', v)}
                  options={[
                    { value: 'tin',        label: 'Tin / corrugated steel' },
                    { value: 'longrun',    label: 'Long-run steel' },
                    { value: 'tile',       label: 'Concrete tile' },
                    { value: 'asbestos',   label: 'Asbestos (REFUSE)' },
                    { value: 'other',      label: 'Other' },
                  ]} placeholder="Select…" />
        </Field>
        <Field label="Roof pitch (degrees)">
          <NumberInput value={ss.roof_pitch_degrees} onChange={v => setSS('roof_pitch_degrees', v)} placeholder="22" />
        </Field>
        <Field label="Shading observations" hint="Brief text — survey notes any obstructions">
          <TextInput value={ss.shading_notes} onChange={v => setSS('shading_notes', v)}
                     placeholder="Minor afternoon shading from neighbour's tree …" />
        </Field>
        <Field label="Battery placement notes">
          <TextInput value={ss.battery_placement_notes} onChange={v => setSS('battery_placement_notes', v)}
                     placeholder="Garage interior, north wall, 600mm clearance …" />
        </Field>
      </SectionGrid>

      <div>
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Switchboard</h3>
        <SectionGrid columns={2}>
          <Field label="Spare RCBO slots available"
                 hint="Number of free positions on the main board. < 2 needs an upgrade.">
            <NumberInput value={sw.spare_rcbo_slots}
                         onChange={v => setSW('spare_rcbo_slots', v)} placeholder="2" />
          </Field>
          <Field label="Main switch rating (A)">
            <NumberInput value={sw.main_switch_amps}
                         onChange={v => setSW('main_switch_amps', v)} placeholder="63" />
          </Field>
        </SectionGrid>
        <div className="mt-3 flex flex-wrap gap-4">
          <CheckBox checked={sw.upgrade_required}
                    onChange={v => setSW('upgrade_required', v)}
                    label="Switchboard upgrade required" />
          <CheckBox checked={sw.asbestos_present}
                    onChange={v => setSW('asbestos_present', v)}
                    label="Asbestos present — HALT" />
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// RoofAnalysisPanel — Google Solar auto-analysis summary
//
// Renders differently per status:
//   ok            — full data table (segments / panels / sunshine / imagery)
//   pending       — spinner-y italic message
//   failed        — orange banner + expandable error detail
//   skipped_quota — orange banner (paused for the month)
//   skipped_flag  — nothing (feature disabled = doesn't exist to user)
//   null / no row — nothing (no analysis on file)
// ────────────────────────────────────────────────────────────────────────────
function RoofAnalysisPanel({ roofAnalysis }) {
  if (!roofAnalysis) return null;
  if (roofAnalysis.status === 'skipped_flag') return null;

  return (
    <div className="border border-slate-200 rounded-lg bg-slate-50 p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
            Roof analysis (Google Solar)
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Auto-populated at enquiry — confirm/override below.
          </p>
        </div>
        <StatusBadge status={roofAnalysis.status} />
      </div>

      {roofAnalysis.status === 'ok' && (
        <>
          {roofAnalysis.roof_image_signed_url && (
            <div className="mb-3">
              <img
                src={roofAnalysis.roof_image_signed_url}
                alt="Aerial view of the roof"
                className="w-full max-h-64 object-contain rounded border border-slate-200 bg-white"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Aerial imagery{roofAnalysis.imagery_date ? ` · ${roofAnalysis.imagery_date}` : ''} · Google Solar
              </p>
            </div>
          )}
          <OkBody a={roofAnalysis} />
        </>
      )}
      {roofAnalysis.status === 'pending' && (
        <p className="text-sm text-slate-600 italic">Analysis in progress — check back in a moment.</p>
      )}
      {roofAnalysis.status === 'failed' && <FailedBody a={roofAnalysis} />}
      {roofAnalysis.status === 'skipped_quota' && (
        <p className="text-sm text-orange-700">
          Auto-analysis paused this month — monthly free-tier quota reached. Site visit recommended.
        </p>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    ok:            { label: 'OK',           cls: 'bg-emerald-100 text-emerald-800' },
    pending:       { label: 'Pending',      cls: 'bg-slate-100 text-slate-600' },
    failed:        { label: 'Unavailable',  cls: 'bg-orange-100 text-orange-800' },
    skipped_quota: { label: 'Quota paused', cls: 'bg-orange-100 text-orange-800' },
  };
  const { label, cls } = map[status] || { label: status || 'unknown', cls: 'bg-slate-100 text-slate-600' };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${cls}`}>{label}</span>
  );
}

function OkBody({ a }) {
  const segCount = Array.isArray(a.roof_segments) ? a.roof_segments.length : 0;
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-slate-700">
      <div>
        Max panel count: <b>{a.max_array_panels_count ?? '—'}</b>
      </div>
      <div>
        Max array area: <b>{fmtArea(a.max_array_area_m2)}</b>
      </div>
      <div>
        Sunshine hours / yr: <b>{a.max_sunshine_hours_per_year != null ? Math.round(a.max_sunshine_hours_per_year) : '—'}</b>
      </div>
      <div>
        Imagery quality: <b>{a.imagery_quality || '—'}</b>
        {a.imagery_date && <span className="text-xs text-slate-500 ml-1">({a.imagery_date})</span>}
      </div>
      <div>
        Roof segments detected: <b>{segCount}</b>
      </div>
      <div>
        Analysed: <span className="text-xs text-slate-500">{fmtDateTime(a.responded_at || a.created_at)}</span>
      </div>
    </div>
  );
}

function FailedBody({ a }) {
  return (
    <div>
      <p className="text-sm text-orange-700">
        Auto-analysis unavailable — site visit recommended.
      </p>
      {a.error_message && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
            Technical detail
          </summary>
          <pre className="mt-1 text-xs text-slate-500 whitespace-pre-wrap break-words">
            {a.error_message}
          </pre>
        </details>
      )}
    </div>
  );
}

function fmtArea(m2) {
  if (m2 == null) return '—';
  return `${Number(m2).toFixed(1)} m²`;
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(iso);
  }
}
