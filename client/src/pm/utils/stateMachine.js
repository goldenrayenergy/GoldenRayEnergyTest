// ── Client-side state-machine helpers ──
// Mirror the server logic so the UI can give instant feedback as the user
// types, without round-tripping to the server.

export function nextForwardState(itemDef, currentState) {
  const order = itemDef.states || [];
  const cur   = order.indexOf(currentState);
  const allowed = (itemDef.transitions?.[currentState] || [])
    .filter(s => order.indexOf(s) > cur)
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return allowed[0] || null;
}

export function missingFieldsForState(itemDef, targetState, fields) {
  if (!targetState) return [];
  const order = itemDef.states || [];
  const tIdx = order.indexOf(targetState);
  if (tIdx < 0) return [];
  return (itemDef.schema?.fields || []).filter(f => {
    if (!f.requiredAt) return false;
    const rIdx = order.indexOf(f.requiredAt);
    if (rIdx < 0 || rIdx > tIdx) return false;
    const v = fields?.[f.key];
    return v === undefined || v === null || v === '';
  }).map(f => ({ key: f.key, label: f.label || f.key }));
}

export function liveMissingForNextState(itemDef, currentState, fields) {
  const next = nextForwardState(itemDef, currentState);
  return { next_state: next, missing_fields: missingFieldsForState(itemDef, next, fields) };
}
