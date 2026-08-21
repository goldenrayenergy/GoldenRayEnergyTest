// ────────────────────────────────────────────────────────────────────────────
// Bridge between our pure-JS panelGrid output and Cesium.Entity instances.
//
// Given an array of panels from computePanelGridOnSegment(), creates one
// Cesium box Entity per panel with the correct position + orientation to
// visually sit on the tilted roof plane.
//
// Cesium coord + orientation notes:
//   - Positions use Cartesian3.fromDegrees(lng, lat, alt).
//   - Orientation is a HeadingPitchRoll around a local ENU (East-North-Up)
//     frame at the entity's position. Per Cesium source, the intrinsic
//     rotation is: heading around -Z, then pitch around -Y', then roll
//     around +X''.
//
//     What each rotation actually affects:
//       heading — CW rotation around Z (top view). After heading = azimuth,
//                 local +Y points in the down-slope direction.
//       pitch   — rotation around -Y. Tilts the XZ plane. Does NOT change
//                 the +Y (down-slope) axis. Wrong axis for our purpose.
//       roll    — rotation around +X. Tilts the YZ plane. DOES change the
//                 +Y direction — positive roll takes +Y toward +Z (up),
//                 negative roll takes +Y toward -Z (down). This is the
//                 axis we need to tilt the panel down-slope.
//
//     So the correct HPR for a panel lying flush on a tilted roof:
//       heading = azimuth      (align local +Y with down-slope direction)
//       pitch   = 0            (unused — wrong axis for slope tilt)
//       roll    = -roofPitch   (tilt down-slope end of panel DOWN by pitch°)
//
//   - Box geometry dimensions map to local axes:
//       x = long side (along ridge)      = panel.dimensions.longM
//       y = short side (up-slope→down)   = panel.dimensions.shortM
//       z = thin (panel thickness)       = 0.04 m
// ────────────────────────────────────────────────────────────────────────────

/**
 * Add panel entities to the Cesium viewer.
 *
 * @param {object} Cesium  the dynamically-imported Cesium namespace
 * @param {object} viewer  the Cesium.Viewer instance
 * @param {Array}  panels  output of computePanelGridOnSegment()
 * @param {object} [options]
 * @param {number} [options.thicknessM=0.15]  panel physical thickness (thickened
 *                                             for demo visibility — reduces to
 *                                             realistic 40 mm in production)
 * @param {number} [options.altitudeOffsetM=2] metres to raise panels above the
 *                                             computed roof height. Google's
 *                                             Photorealistic 3D Tiles mesh
 *                                             surface doesn't always match
 *                                             Google Solar's `planeHeightAtCenterMeters`
 *                                             exactly, so a small lift keeps
 *                                             panels visible above the tile
 *                                             geometry rather than z-fighting
 *                                             or being occluded.
 * @param {string} [options.color='#1F3A5C']  panel body colour (fallback when
 *                                             colorFn is not provided)
 * @param {string} [options.outlineColor='#7BA1D0']  panel edge colour
 * @param {(panel) => string} [options.colorFn]  when provided, called per
 *   panel to derive a per-panel hex body colour. Used by the yield-heatmap
 *   overlay so each panel's tint reflects its own annual kWh. If omitted,
 *   every panel gets `options.color`.
 * @returns {Array} array of created Cesium.Entity instances (for teardown)
 */
export function addPanelEntities(Cesium, viewer, panels, options = {}) {
  const thicknessM      = options.thicknessM      ?? 0.15;
  const altitudeOffsetM = options.altitudeOffsetM ?? 2;
  const bodyColor       = options.color           || '#1F3A5C';
  const edgeColor       = options.outlineColor    || '#7BA1D0';
  const colorFn         = typeof options.colorFn === 'function' ? options.colorFn : null;

  const defaultCesiumColor = Cesium.Color.fromCssColorString(bodyColor);
  const cesiumEdge         = Cesium.Color.fromCssColorString(edgeColor);
  // Tiny colour cache — colorFn returns hex strings, and adjacent panels on
  // one segment often land on the same/very-close bucket. Skip re-parsing
  // when we can (typical roof produces ~5 distinct colours across 30 panels).
  const colorCache = new Map();
  const cesiumColorFromHex = (hex) => {
    let c = colorCache.get(hex);
    if (!c) { c = Cesium.Color.fromCssColorString(hex); colorCache.set(hex, c); }
    return c;
  };

  const created = [];
  for (const p of panels) {
    if (!p?.center?.latitude || !p?.center?.longitude) continue;

    const position = Cesium.Cartesian3.fromDegrees(
      p.center.longitude,
      p.center.latitude,
      (p.center.altitude || 0) + altitudeOffsetM,
    );

    // Heading + pitch + roll in RADIANS.
    // heading = azimuth aligns local frame so local +Y points down-slope.
    // pitch   = 0 (pitch rotates around -Y which doesn't affect down-slope).
    // roll    = -roofPitch tilts down-slope end (+Y) of panel DOWN by pitch°,
    //           so the panel lies flush on the tilted roof plane.
    const hpr = new Cesium.HeadingPitchRoll(
      Cesium.Math.toRadians(p.azimuthDeg),
      0,
      Cesium.Math.toRadians(-p.pitchDeg),
    );
    const orientation = Cesium.Transforms.headingPitchRollQuaternion(position, hpr);

    // Per-panel body colour when colorFn provided (heatmap mode); otherwise
    // a single shared colour for every panel (legacy behaviour).
    const bodyHex = colorFn ? colorFn(p) : bodyColor;
    const materialColor = colorFn ? cesiumColorFromHex(bodyHex) : defaultCesiumColor;

    const entity = viewer.entities.add({
      position,
      orientation,
      box: {
        dimensions: new Cesium.Cartesian3(
          p.dimensions.longM,
          p.dimensions.shortM,
          thicknessM,
        ),
        material: materialColor,
        outline: true,
        outlineColor: cesiumEdge,
        outlineWidth: 2,
        // Panels receive shadow from adjacent tree/building meshes so the
        // customer can see which panels sit in shade at any given clock
        // time (Feature B1 timeline). RECEIVE_ONLY (not CAST_AND_RECEIVE)
        // because the panel-strip shadows on the roof surface below would
        // add visual noise without communicating anything useful.
        shadows: Cesium.ShadowMode.RECEIVE_ONLY,
        // Draw panels ON TOP of the 3D Tile mesh regardless of depth —
        // otherwise Google's Photorealistic 3D Tiles occlude them.
        // POSITIVE_INFINITY = never depth-tested against terrain/tiles.
        // We're happy with this trade-off for the marketing visual because
        // panels are a critical UX element the customer must see.
      },
      // Never occlude the panels by terrain / photorealistic tile mesh.
      // Cesium reads disableDepthTestDistance on the graphics primitive.
    });
    // Stash the raw panel data on the entity so the parent's screen-space
    // pick handler (yield-heatmap hover tooltip) can read per-panel details
    // without a side lookup. Using a private field name avoids the Cesium
    // Property/PropertyBag wrapping that entity.properties applies.
    entity.__panelData = p;
    // Also stash the heatmap body colour so downstream re-paints
    // (setPanelMaterial for opacity/shade changes) can preserve the
    // per-panel tint instead of collapsing every panel to the default
    // navy. Only set when colorFn was used — otherwise stays undefined
    // and setPanelMaterial falls back to its hardcoded default.
    if (colorFn) entity.__heatmapColor = bodyHex;
    // Apply once entity is created (some geometry types need direct access)
    if (entity.box) {
      // No direct disableDepthTestDistance on box graphics — visibility
      // relies on altitudeOffsetM lifting the panel above the mesh.
    }
    created.push(entity);
  }
  return created;
}

/**
 * Remove a set of previously-added entities. Call this when panels need to
 * be recomputed (address change, tier change, etc.).
 */
export function removePanelEntities(viewer, entities) {
  if (!entities || !viewer?.entities) return;
  for (const e of entities) viewer.entities.remove(e);
}
