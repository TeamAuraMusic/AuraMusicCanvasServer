import express from 'express';
import canvasRoutes from './routes/canvasRoutes.js';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

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

app.listen(PORT, () => {
  console.log('Listening on PORT:', PORT);
});
