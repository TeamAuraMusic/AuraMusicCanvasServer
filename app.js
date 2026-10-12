import express from 'express';
import canvasRoutes from './routes/canvasRoutes.js';

// Startup diagnostics: report whether the Spotify cookie is actually present
// (length only, never the value) so a bad env config is obvious in the deploy
// log instead of surfacing later as a 401 from Spotify.
// Reported per request as well as at boot: on Workers the secret can land after
// the module graph is built, so a startup-only check can be misleading.
function reportConfig() {
  const spDc = process.env.SP_DC || globalThis.__ENV?.SP_DC;
  if (spDc) {
    console.log(`[config] SP_DC present (len=${spDc.length})`);
    return;
  }
  console.warn('[config] SP_DC not visible yet - will be re-checked on each request');
}
reportConfig();

const app = express();

// Re-check on the first request: the secret can land after the module graph is
// built, and a warning printed at boot alone would not catch that.
let configCheckedOnRequest = false;
app.use((_req, _res, next) => {
  if (!configCheckedOnRequest) {
    configCheckedOnRequest = true;
    reportConfig();
  }
  next();
});

app.use(express.json({ limit: '64kb' }));

// Friendly root so visitors aren't greeted by "Cannot GET /".
app.get('/', (req, res) => {
  res.json({
    service: 'auramusic-canvas-server',
    endpoints: {
      health: 'GET /health',
      canvas: 'GET /api/canvas?trackId=<id> | ?song=&artist=&album=&durationMs=',
      artist: 'POST /api/canvas/artist { artist, candidates:[{title,artist,album,durationMs}] }',
      album:  'POST /api/canvas/album  { album, artist, candidates:[{title,artist,album,durationMs}] }',
    },
  });
});

// Simple health endpoint for keep-warm pings and monitoring.
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'auramusic-canvas-server',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/canvas', canvasRoutes);

// Surface failures as real 5xx instead of a generic HTML error page, so a bad
// SP_DC shows up as an auth problem rather than looking like "no canvas found".
app.use((err, req, res, next) => {
  const status = err?.status || err?.response?.status || 500;
  console.error(`[error] ${req.method} ${req.originalUrl} -> ${status}:`, err?.message || err);
  if (res.headersSent) return next(err);
  res.status(status === 401 || status === 403 ? 502 : status).json({
    success: false,
    error: status === 401 || status === 403
      ? 'Spotify auth failed - SP_DC is missing or expired'
      : (err?.message || 'Internal error'),
  });
});

export default app;
