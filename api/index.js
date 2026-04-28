// Vercel serverless entry point.
// We re-use the existing Express app (server/app.js) so a single source of
// truth runs in both `npm run dev` (long-lived Node process) and on Vercel
// (one-shot serverless invocation per request).
//
// Note: PDF endpoints that depend on Puppeteer (e.g. POST /api/proposals/:id/pdf)
// will fail in this default Vercel runtime because Chrome is not bundled.
// Either swap to a separate backend host (Render/Railway) for full Puppeteer
// support, or wire up @sparticuz/chromium as a follow-up.

import serverless from 'serverless-http';
import app from '../server/app.js';

// serverless-http wraps the Express app and converts each Vercel function
// invocation into an Express request/response cycle.
export default serverless(app);
