// RedPrompt — static file server.
// All LLM work happens client-side via WebLLM. This server just serves
// the static frontend so the project runs locally with `node server.js`
// and is equally happy deployed to any static host (GitHub Pages, Netlify,
// Vercel, S3, etc.). You can also drop this file entirely and use
// `python -m http.server` or any static host.
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');

// Public-safety headers. CSP is intentionally WebLLM-compatible:
// it allows esm.run imports, WASM/WebGPU runtime behavior, blob workers,
// model downloads over HTTPS, and Google Fonts.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://esm.run 'unsafe-eval' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; connect-src 'self' https: blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'"
};

app.use((req, res, next) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  // Don't cache app assets during development; WebLLM/model weights are cached by the browser separately.
  setHeaders: (res, p) => {
    if (/\.(html|js|css|json)$/.test(p)) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
}));

// SPA fallback — browser routes serve index.html, but missing assets/data return 404.
app.get('*', (req, res) => {
  if (req.path.startsWith('/data/') || path.extname(req.path)) {
    return res.status(404).send('Not found');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  RedPrompt v4.0 — Static + WebLLM`);
  console.log(`  📍 http://localhost:${PORT}\n`);
  console.log(`  💻 100% in-browser LLM (WebGPU). No API key. No server LLM.`);
  console.log(`  🚀 Deploy the 'public/' folder to any static host.\n`);
});
