import TaskFormGeneric from '../TaskFormGeneric';

// ── System design ──
// Defines the system spec (panel make/model, inverter make/model, battery
// make/model, layout, simulation, designer/reviewer). The actual purchasing
// list (BOM) belongs to the next task in the Engineering lane —
// Bill of Materials locked — not here.
//
// Phase B+ extension idea: a Mapbox roof-imagery panel-layout designer
// that renders panels onto satellite imagery of the address. For now this
// is a thin wrapper around the schema-driven form.

export default function SystemDesignForm({ schema, values, currentState, missingFields, upstreamSuggestions, onChange, readOnly }) {
  return (
    <div>
      <div className="bg-sky-50 border border-sky-200 rounded p-3 mb-3 text-xs text-sky-900">
        Capture the system specification: orientation, panel + inverter + battery make/model, string config, simulation, designer + reviewer sign-off.
        <br />
        The full purchasing list (BOM) is the next task — <strong>Bill of Materials locked</strong>.
      </div>

      <TaskFormGeneric
        schema={schema}
        values={values}
        currentState={currentState}
        missingFields={missingFields}
        upstreamSuggestions={upstreamSuggestions}
        onChange={onChange}
        readOnly={readOnly}
      />
    </div>
  );
}
