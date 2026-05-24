import axios from 'axios';
import { getCanvases } from '../services/spotifyCanvasService.js';
import { getToken } from '../services/spotifyAuthService.js';

async function searchTracks(song, artist, album, limit = 5) {
  try {
    const accessToken = await getToken();

    let queryParts = [];
    if (song) queryParts.push(`track:"${song}"`);
    if (artist) queryParts.push(`artist:"${artist}"`);
    if (album) queryParts.push(`album:"${album}"`);

    const query = queryParts.join(' ').trim();
    if (!query) return [];

    const response = await axios.get('https://api.spotify.com/v1/search', {
      params: {
        q: query,
        type: 'track',
        limit
      },
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data?.tracks?.items || [];
  } catch (err) {
    console.error('Spotify search error:', err.response?.data || err.message);
    return [];
  }
}

export const fetchCanvas = async (req, res) => {
  let { trackId, trackIds, song, artist, album } = req.query;

  let ids = [];
  if (trackId) ids.push(trackId);
  if (trackIds) ids = ids.concat(trackIds.split(',').map(s => s.trim()).filter(Boolean));

  // Support simple song + artist query (used by some client paths)
  if (ids.length === 0 && (song || artist)) {
    const tracks = await searchTracks(song, artist, album);
    ids = tracks.map(t => t.id).filter(Boolean);
  }

  if (ids.length === 0) {
    return res.status(400).json({ error: 'Missing trackId, trackIds, or song+artist parameters' });
  }

  const results = [];
  for (const id of ids) {
    const data = await getCanvases(`spotify:track:${id}`);
    if (data && data.canvasesList && data.canvasesList.length > 0) {
      results.push(data);
    }
  }

  if (results.length === 0) {
    return res.status(404).json({ error: 'No canvas found for provided track(s)' });
  }

  // Single track: return original shape for compatibility
  if (ids.length === 1) {
    res.json(results[0]);
  } else {
    res.json({ canvases: results });
  }
};

export const fetchArtistCanvas = async (req, res) => {
  const { artist, tracks } = req.body || {};
  if (!artist || !Array.isArray(tracks) || tracks.length === 0) {
    return res.status(400).json({ success: false, error: 'Missing artist or tracks array' });
  }

  for (const trackId of tracks) {
    if (!trackId) continue;
    const data = await getCanvases(`spotify:track:${trackId}`);
    if (data && data.canvasesList && data.canvasesList.length > 0) {
      const first = data.canvasesList[0];
      return res.json({
        success: true,
        canvasUrl: first.canvasUrl,
        url: first.canvasUrl,
        artist,
        trackId,
        data
      });
    }
  }

  res.status(404).json({ success: false, error: 'No canvas found for artist' });
};

export const fetchAlbumCanvas = async (req, res) => {
  const { album, artist, tracks } = req.body || {};
  if (!album || !artist || !Array.isArray(tracks) || tracks.length === 0) {
    return res.status(400).json({ success: false, error: 'Missing album, artist or tracks array' });
  }

  for (const trackId of tracks) {
    if (!trackId) continue;
    const data = await getCanvases(`spotify:track:${trackId}`);
    if (data && data.canvasesList && data.canvasesList.length > 0) {
      const first = data.canvasesList[0];
      return res.json({
        success: true,
        canvasUrl: first.canvasUrl,
        url: first.canvasUrl,
        album,
        artist,
        trackId,
        data
      });
    }
  }

  res.status(404).json({ success: false, error: 'No canvas found for album' });
};
