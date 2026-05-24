import express from 'express';
import axios from 'axios';
import canvasRoutes from './routes/canvasRoutes.js';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// Simple health endpoint for keep-warm pings and monitoring
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    service: 'auramusic-canvas-server',
    timestamp: new Date().toISOString()
  });
});

app.use('/api/canvas', canvasRoutes);

app.listen(PORT, function () {
    console.log("Listening on PORT: ", PORT);
});