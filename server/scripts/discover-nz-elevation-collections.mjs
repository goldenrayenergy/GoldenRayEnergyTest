// One-off discovery script for LINZ nz-elevation 1m DSM collections.
//
// Fetches the root catalog + every 1m DSM collection.json, extracts each
// collection's bbox, and writes the result to a static JSON file the server
// imports at startup. This lets `findDsmCogForPoint` first FILTER
// collections by bbox (fast, in-memory) and only then load items for the
// matching collection(s).
//
// Run:  node server/scripts/discover-nz-elevation-collections.mjs
// Re-run periodically (quarterly) or when LINZ adds new surveys.

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE  = path.join(__dirname, '..', 'services', 'linz', 'nz-elevation-collections.json');
const ROOT      = 'https://nz-elevation.s3-ap-southeast-2.amazonaws.com';

// bounded concurrency helper
async function mapWithConcurrency(items, fn, concurrency = 12) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    results.push(...(await Promise.all(chunk.map(fn))));
  }
  return results;
}

async function main() {
  console.log(`Fetching root catalog…`);
  const rootResp = await fetch(`${ROOT}/catalog.json`);
  if (!rootResp.ok) throw new Error(`root catalog: ${rootResp.status}`);
  const root = await rootResp.json();

  const dsmLinks = (root.links || [])
    .filter(l => l.rel === 'child' && l.href.includes('dsm_1m/2193'));

  console.log(`Found ${dsmLinks.length} 1m DSM collections. Loading bboxes in parallel…`);
  const collections = await mapWithConcurrency(dsmLinks, async (link) => {
    const collUrl = new URL(link.href, `${ROOT}/catalog.json`).toString();
    try {
      const r = await fetch(collUrl);
      if (!r.ok) return null;
      const c = await r.json();
      const bbox = c.extent?.spatial?.bbox?.[0];
      if (!Array.isArray(bbox) || bbox.length < 4) return null;
      // Path relative to bucket root, without leading "./" and without "/collection.json"
      const collectionPath = link.href.replace(/^\.\//, '').replace(/\/collection\.json$/, '');
      return {
        collectionPath,
        title:  c.title || link.title,
        bbox,                     // [minLng, minLat, maxLng, maxLat] WGS84
        itemCount: (c.links || []).filter(l => l.rel === 'item').length,
      };
    } catch (e) {
      console.warn(`  skip ${link.href}: ${e.message}`);
      return null;
    }
  }, 12);

  const kept = collections.filter(Boolean);
  console.log(`✓ Loaded ${kept.length} collections`);

  // Sort by area (largest bbox first — usually the big regional surveys).
  kept.sort((a, b) => {
    const areaA = (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]);
    const areaB = (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]);
    return areaB - areaA;
  });

  const output = {
    generatedAt: '2026-08-06',       // update on re-run
    catalogUrl:  `${ROOT}/catalog.json`,
    total:       kept.length,
    collections: kept,
  };

  await fs.writeFile(OUT_FILE, JSON.stringify(output, null, 2));
  console.log(`✓ Wrote ${OUT_FILE}`);
  console.log(`  Regions covered: ${[...new Set(kept.map(c => c.collectionPath.split('/')[0]))].join(', ')}`);
}

main().catch(e => { console.error(e); process.exit(1); });
