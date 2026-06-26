// ────────────────────────────────────────────────────────────────────────────
// Report it — client side. Persists a report to the backend (deduped server-
// side by fingerprint) and shows the standard confirmation. Never throws / never
// blocks the rep: a failed report is swallowed (the global safety net still held
// — the rep saw their card).
// ────────────────────────────────────────────────────────────────────────────
import api from '../../services/api';

// Low-level: POST a report payload. Returns { stored, deduped, report } or
// { stored:false } on any failure.
export async function submitReport(payload) {
  try {
    const { data } = await api.post('/pm/error-reports', payload);
    return data || { stored: false };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('submitReport failed:', e?.message);
    return { stored: false };
  }
}

// High-level: report from a catalogue entry (carries code/owner/severity/area/
// title), with the standard "thanks" confirmation. `fingerprint` defaults to the
// code; pass an override when one code spans many distinct situations.
export async function reportEntry(entry, { screen, detail, context, fingerprint } = {}) {
  await submitReport({
    code: entry?.code,
    fingerprint: fingerprint || entry?.code,
    area: entry?.area, owner: entry?.owner, severity: entry?.severity, title: entry?.title,
    screen, detail, context: context || {},
  });
  // eslint-disable-next-line no-alert
  alert('Thanks — this is saved for the dev team.\n\nRepeated reports of the same issue are grouped into one, with a count, so the team sees how often it happens.');
}
