import { Field, Select, SectionGrid, SectionHeading, CheckBox } from './_shared';
import { REFERENCE } from '../../services/pmQuotesApi';

export default function PreferencesSection({ spec, update }) {
  const p = spec.preferences || {};
  const f = p.future_loads || {};
  const fin = p.financing || {};
  const setP = (key, val) => update(s => ({ ...s, preferences: { ...s.preferences, [key]: val } }));
  const setFut = (key, val) => update(s => ({
    ...s,
    preferences: { ...s.preferences, future_loads: { ...(s.preferences?.future_loads || {}), [key]: val } },
  }));
  const setFin = (key, val) => update(s => ({
    ...s,
    preferences: { ...s.preferences, financing: { ...(s.preferences?.financing || {}), [key]: val } },
  }));

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Customer preferences"
        subtitle="Backup priority + decision-makers + planned future loads + financing choice. Shapes the proposal narrative." />

      <SectionGrid columns={2}>
        <Field label="Backup priority"
               hint="Drives battery sizing recommendation + which circuits go on the critical loads sub-board.">
          <Select value={p.backup_priority} onChange={v => setP('backup_priority', v)}
                  options={REFERENCE.backupPriorities} />
        </Field>
        <Field label="Decision-makers" hint="Two signers means the proposal cover page lists both for signature.">
          <Select value={p.decision_makers} onChange={v => setP('decision_makers', v)}
                  options={REFERENCE.decisionMakers} />
        </Field>
      </SectionGrid>

      <div>
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Planned future loads</h3>
        <div className="flex flex-wrap gap-4">
          <CheckBox checked={f.ev_planned_2yr}
                    onChange={v => setFut('ev_planned_2yr', v)}
                    label="EV planned within 2 years" />
          <CheckBox checked={f.heat_pump_upgrade}
                    onChange={v => setFut('heat_pump_upgrade', v)}
                    label="Heat pump / hot water upgrade" />
          <CheckBox checked={f.spa_pool}
                    onChange={v => setFut('spa_pool', v)}
                    label="Spa pool or major load" />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Financing</h3>
        <SectionGrid columns={2}>
          <Field label="Financing choice"
                 hint="Drives the loan amortisation panel + monthly cashflow chart on the customer PDF.">
            <Select value={fin.choice} onChange={v => setFin('choice', v)} options={REFERENCE.financing} />
          </Field>
        </SectionGrid>
      </div>
    </div>
  );
}
