import { Router } from 'express';

const router = Router();

// Public proxy for the address autocomplete on the website quote form.
//
// Why proxy instead of calling Nominatim from the browser:
//   1. Nominatim doesn't always include Access-Control-Allow-Origin on responses,
//      so direct browser calls get blocked by CORS.
//   2. Their usage policy requires a custom User-Agent identifying the app —
//      browsers don't allow setting one from JS.
//   3. Centralising the provider here means we can swap to Google Places or
//      Addressfinder later by editing this single file.

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'GoldenRayEnergyNZ/1.0 (https://goldenrayenergy.co.nz)';

router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (q.length < 3) return res.json([]);

    const params = new URLSearchParams({
      q,
      format: 'json',
      addressdetails: '1',
      countrycodes: 'nz',
      limit: '6',
    });

    const r = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    });
    if (!r.ok) return res.status(502).json({ error: `upstream ${r.status}` });
    const data = await r.json();
    res.set('Cache-Control', 'public, max-age=60');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
