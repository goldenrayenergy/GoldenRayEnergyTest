// ────────────────────────────────────────────────────────────────────────────
// Auto-size system from bill-analysis recommendations.
//
// Inputs:
//   recommended_system_kw   — from bill_analyses.recommended_system_kw
//   recommended_battery_kwh — from bill_analyses.recommended_battery_kwh
//   panelWattsDefault       — engine catalogue panel watts (default 595 = Phono Draco)
//   batteryKwhPerModule     — module size (default 2.76 = BYD HVM)
//
// Outputs an object that can be spread into spec.system to overwrite the
// placeholder defaults from emptySpec().
//
// Heuristics:
//   • Panel count rounded to multiple of 4 (clean string-design math)
//   • Battery module count clamped to BYD HVM rule range [3–8]
//   • Topology: series for ≤16 panels, parallel for >16 (helps Voc-cold check
//     stay safe on Plus inverter at NZ -10°C winter)
//   • String design picked so Voc_cold × panels_per_string < 450V (Fronius
//     reduced-mode threshold), with reasonable string_count
// ────────────────────────────────────────────────────────────────────────────

export function autoSizeSystem({
  recommended_system_kw,
  recommended_battery_kwh,
  panelWattsDefault = 595,
  batteryKwhPerModule = 2.76,
}) {
  if (!recommended_system_kw || recommended_system_kw <= 0) return null;

  // 1. Panel count from kW. Round to multiple of 4 so string design comes out
  // clean (5×4, 6×4, 5×5, etc.).
  const rawCount = (recommended_system_kw * 1000) / panelWattsDefault;
  let panelCount = Math.round(rawCount / 4) * 4;
  if (panelCount < 8) panelCount = 8;      // floor: minimum sensible system
  if (panelCount > 60) panelCount = 60;    // engine config_validator ceiling

  // 2. Battery modules. Clamp to BYD HVM allowed counts [3, 4, 5, 6, 7, 8].
  let batteryModuleCount = null;
  let includeBattery = false;
  if (recommended_battery_kwh && recommended_battery_kwh > 0) {
    const raw = recommended_battery_kwh / batteryKwhPerModule;
    batteryModuleCount = Math.max(3, Math.min(8, Math.round(raw)));
    includeBattery = true;
  }

  // 3. Topology + string design.
  //    Goal: Voc_cold × panels_per_string < 600V (engine Voc-max gate).
  //    Phono Draco Voc_stc 52.92V × cold correction 1.0875 = ~57.55V/panel @ -10°C.
  //    So panels_per_string ≤ 10 is safe in Auckland; we cap at 6 to leave headroom.
  let panelsPerString, stringCount, topology;
  if (panelCount <= 16) {
    // Series: single string per MPPT, or 2 strings (5+5 or 6+6, etc.)
    topology = 'series';
    if (panelCount % 6 === 0)      { panelsPerString = 6; stringCount = panelCount / 6; }
    else if (panelCount % 5 === 0) { panelsPerString = 5; stringCount = panelCount / 5; }
    else if (panelCount % 4 === 0) { panelsPerString = 4; stringCount = panelCount / 4; }
    else                            { panelsPerString = panelCount; stringCount = 1; }
  } else {
    // Parallel: 4 strings across 2 MPPTs
    topology = 'parallel';
    if (panelCount % 6 === 0)      { panelsPerString = 6; stringCount = panelCount / 6; }
    else if (panelCount % 5 === 0) { panelsPerString = 5; stringCount = panelCount / 5; }
    else if (panelCount % 4 === 0) { panelsPerString = 4; stringCount = panelCount / 4; }
    else                            { panelsPerString = Math.ceil(panelCount / 4); stringCount = 4; }
  }

  return {
    panel_count: panelCount,
    battery_module_count: batteryModuleCount,
    include_battery: includeBattery,
    string_topology: topology,
    panels_per_string: panelsPerString,
    string_count: stringCount,
    derived_kw: +(panelCount * panelWattsDefault / 1000).toFixed(2),
    derived_battery_kwh: includeBattery
      ? +(batteryModuleCount * batteryKwhPerModule).toFixed(2)
      : 0,
    note:
      `Auto-sized from bill analysis (${recommended_system_kw} kW recommended` +
      (recommended_battery_kwh ? ` + ${recommended_battery_kwh} kWh battery` : '') +
      `). Adjust if site survey reveals different roof capacity, shading, or budget.`,
  };
}
