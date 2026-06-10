import { Field, TextInput, NumberInput, Select, SectionGrid, SectionHeading, CheckBox } from './_shared';

// Only rendered for stage_2_firm quotes. Stage 1 has these fields as
// "unverified — confirmed at site survey" so the survey form just collects
// the missing data and unlocks the firm offer.
export default function SiteSurveySection({ spec, update }) {
  const ss = spec.site_survey || {};
  const sw = ss.switchboard || {};
  const setSS = (key, val) => update(s => ({ ...s, site_survey: { ...s.site_survey, [key]: val } }));
  const setSW = (key, val) => update(s => ({
    ...s,
    site_survey: { ...s.site_survey, switchboard: { ...(s.site_survey?.switchboard || {}), [key]: val } },
  }));

  return (
    <div className="space-y-6">
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
