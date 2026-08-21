import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';
import { Agent } from 'node:http';

export default defineConfig({
  plugins: [
    react(),
    // vite-plugin-cesium handles Cesium's worker + static-asset paths so we
    // don't have to hand-copy them. Cesium's Workers/, ThirdParty/, Assets/,
    // Widgets/ directories get published under /cesium/ at runtime.
    cesium(),
  ],
  server: {
    port: 5173,
    // Accept any Host header so VS Code Dev Tunnels / ngrok / cloudflared
    // can forward external traffic to this dev server without Vite rejecting
    // it with "Blocked request. This host is not allowed." Dev-only — Vite
    // isn't running in production.
    allowedHosts: true,
    proxy: {
      // ── /api → Express on :5000 ──────────────────────────────────────────
      // Full proxy block (not the `'/api': 'http://localhost:5000'` shorthand)
      // to work around a class of empty-body 500s the browser sees while the
      // server logs a clean 200. Root causes we hit:
      //
      //   1. Keep-alive pool poisoning. `http-proxy-middleware`'s default
      //      agent reuses TCP sockets to the upstream. When `node --watch`
      //      restarts the server (file save mid-session), the reused socket
      //      is dead — but Vite doesn't know until the NEXT request tries
      //      it, and by then the request is already committed. Result:
      //      `ECONNRESET` on an unrelated request, shown to the browser as
      //      a bare `text/plain` 500. Fix: `keepAlive: false` → every
      //      request opens a fresh socket, so a dying socket only affects
      //      the one request in flight.
      //
      //   2. Silent proxy errors. Default config eats socket errors and
      //      just returns the 500; nothing appears in either terminal.
      //      Fix: `configure` hook that logs each proxy failure so the
      //      real error (`ECONNRESET`, `ECONNREFUSED`, socket hang up) is
      //      visible in the Vite terminal.
      //
      //   3. LiDAR cold-start timeout race. The `/api/poc/roof/analyse`
      //      LiDAR fallback path (STAC catalogue fetch + DSM COG download
      //      + RANSAC plane fitting) can take 30-60s cold. `http-proxy`
      //      does not enforce a timeout by default, but if a future proxy
      //      version changes the default we want a safe explicit ceiling.
      //
      //   4. `changeOrigin` — even for same-host proxying, some middlewares
      //      behind the target check the Host header. Safe default.
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        timeout:      120_000,   // client-side socket read timeout
        proxyTimeout: 120_000,   // proxy → upstream response timeout
        agent: new Agent({ keepAlive: false }),
        configure: (proxy) => {
          proxy.on('error', (err, req) => {
            console.error(
              `[vite-proxy] ${req.method || '?'} ${req.url || '?'} → ${err.code || err.message}`,
            );
          });
        },
      },
    },
  },
});
