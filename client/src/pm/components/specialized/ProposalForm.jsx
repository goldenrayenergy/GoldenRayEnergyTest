import TaskFormGeneric from '../TaskFormGeneric';

// ── Initial / Final proposal — Phase A.2.2 stub ──
// The real proposal generator (Stage 1 / Stage 2 logic, bill-analysis input,
// PDF render with SLD + T&Cs) lands in Phase B. For now, this just makes
// the difference between Stage 1 (initial) and Stage 2 (final) explicit
// in the UI and renders the structured fields the schema declares.

export default function ProposalForm({ stage, schema, values, currentState, missingFields, upstreamSuggestions, onChange }) {
  const isFinal = stage === 'final';

  return (
    <div>
      <div className={`mb-4 px-3 py-2 rounded border text-sm ${
        isFinal ? 'bg-emerald-50 border-emerald-200' : 'bg-sky-50 border-sky-200'
      }`}>
        <div className={`font-semibold mb-1 ${isFinal ? 'text-emerald-900' : 'text-sky-900'}`}>
          {isFinal ? 'Stage 2 — Final proposal' : 'Stage 1 — Initial proposal'}
        </div>
        <p className={`text-xs ${isFinal ? 'text-emerald-800' : 'text-sky-800'}`}>
          {isFinal
            ? 'Locked pricing. Includes SLD, full BOM with brand/model/datasheet, T&Cs (with inline accept), warranty schedule, and digital signature block. Generated post-site-survey.'
            : 'Indicative cost range + payback range + 25-year scenario projection. Pulls from bill analysis + household profile. No SLD or signed T&Cs.'}
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-4 text-xs text-amber-900">
        <strong>Phase B coming:</strong> the proposal generator will let you click <em>Generate {stage} proposal</em> and produce a customer-facing PDF + magic-link viewer using the bill_analysis and BOM already attached to this project. For now, capture the cost / payback / send-status fields manually below — the schema engine still records audit and notes.
      </div>

      <TaskFormGeneric
        schema={schema}
        values={values}
        currentState={currentState}
        missingFields={missingFields}
        upstreamSuggestions={upstreamSuggestions}
        onChange={onChange}
      />
    </div>
  );
}
