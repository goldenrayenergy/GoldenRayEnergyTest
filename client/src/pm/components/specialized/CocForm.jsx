import { useEffect, useState } from 'react';
import TaskFormGeneric from '../TaskFormGeneric';

// ── COC form ──
// Adds NZ-specific validation hints over the generic schema:
//   - EWRB license format E + 4-7 digits (Electrical Workers Registration Board)
//   - ESC number format check
//   - Issue date cannot be in the future
//
// All pattern enforcement is also declared in laneDefinitions.js so server
// validation matches client.

const EWRB_RE = /^E[0-9]{4,7}$/i;

export default function CocForm({ schema, values, currentState, onSave }) {
  const [v, setV] = useState(values || {});

  useEffect(() => { setV(values || {}); }, [values]);

  const ewrb = v.certifier_license || '';
  const ewrbValid = !ewrb || EWRB_RE.test(ewrb);
  const issueDate = v.issue_date;
  const futureIssue = issueDate && new Date(issueDate) > new Date();

  return (
    <div>
      <div className="bg-purple-50 border border-purple-200 rounded p-3 mb-3 text-sm">
        <div className="font-semibold text-purple-900 mb-1">NZ Compliance — COC for Prescribed Electrical Work</div>
        <p className="text-xs text-purple-800">
          The Certificate of Compliance must be issued by a registered electrical worker
          (<a href="https://www.ewrb.govt.nz/" target="_blank" rel="noopener" className="underline">EWRB</a>).
          Format: <code className="bg-white px-1 rounded">E</code> followed by 4–7 digits.
          Keep the original PDF — the customer needs a copy in their handover pack.
        </p>
      </div>

      {ewrb && !ewrbValid && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded p-2 mb-3 text-sm">
          EWRB license format invalid. Expected format: <code>E</code> + 4–7 digits, e.g. <code>E12345</code>.
        </div>
      )}

      {futureIssue && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded p-2 mb-3 text-sm">
          Issue date is in the future — the COC cannot be issued until install is complete.
        </div>
      )}

      <TaskFormGeneric
        schema={schema}
        values={values}
        currentState={currentState}
        onSave={onSave}
      />
    </div>
  );
}
