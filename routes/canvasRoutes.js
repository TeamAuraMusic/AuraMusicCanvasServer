import express from 'express';
import { fetchCanvas, fetchArtistCanvas, fetchAlbumCanvas } from '../controllers/canvasController.js';

const router = express.Router();

// Existing single or multi track lookup (supports ?trackId= or ?trackIds=id1,id2)
router.get('/', fetchCanvas);

// Artist on-demand canvases (used for artist headers)
router.post('/artist', fetchArtistCanvas);

// Album on-demand canvases (used for album covers)
router.post('/album', fetchAlbumCanvas);

export default router;
