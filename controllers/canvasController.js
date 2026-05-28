import axios from 'axios';
import { getCanvases } from '../services/spotifyCanvasService.js';
import { getToken } from '../services/spotifyAuthService.js';
import { searchSpotifyTracks } from '../services/spotifySearchService.js';

// ---------------------------------------------------------------------------
// In-memory caches. Render free-tier dynos restart often so this is enough for
// burst traffic; not a substitute for a real KV store.
// ---------------------------------------------------------------------------
const POSITIVE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const NEGATIVE_TTL_MS = 60 * 60 * 1000;      // 1h

// key -> { trackId, expiresAt }
const trackIdCache = new Map();
// trackId -> { data | null, expiresAt }
const canvasCache = new Map();

function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\([^)]*\)|\[[^\]]*]/g, ' ')
    .replace(/\b(remaster(ed)?|live|explicit|official\s*video|lyrics?|audio|hd|hq|feat\.?|ft\.?|with)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function lookupKey(song, artist, album) {
  return [norm(song), norm(artist), norm(album)].join('\u0001');
}

function scoreCandidate(track, song, artist, durationMs) {
  let score = 0;
  const nSong = norm(song);
  const nArtist = norm(artist);
  if (nSong && norm(track.name) === nSong) score += 4;
  else if (nSong && norm(track.name).includes(nSong)) score += 2;

  if (nArtist) {
    const artistsNorm = (track.artists || []).map(a => norm(a.name));
    if (artistsNorm.some(a => a === nArtist)) score += 3;
    else if (artistsNorm.some(a => a.includes(nArtist) || nArtist.includes(a))) score += 1;
    else {
      // No artist match when artist is provided - penalize significantly
      // This prevents wrong artist canvases from being selected
      score -= 5;
    }
  }

  if (durationMs && track.duration_ms) {
    const diff = Math.abs(track.duration_ms - durationMs);
    if (diff <= 2_000) score += 2;
    else if (diff <= 5_000) score += 1;
  }
  return score;
}

/**
 * Search Spotify for the given (song, artist[, album]) and return candidates
 * locally re-ranked by how well they match the requested title/artist/duration.
 *
 * Resolution goes through the Pathfinder GraphQL endpoint (the same Spotify
 * web-player itself uses) which is NOT rate-limited per cloud IP the way
 * api.spotify.com/v1/search is – critical when running on a shared Render
 * dyno.
 */
async function searchTracks(song, artist, album, durationMs, limit = 10) {
  // A simple free-form query consistently beats `field:` filters on Spotify
  // for messy YT-Music titles like "Title (Remix) feat. X".
  const q = [song, artist].filter(Boolean).join(' ').trim();
  if (!q) return [];
  const items = await searchSpotifyTracks(q, limit);
  if (!items.length) return [];
  // Re-rank locally so the BEST candidate is checked for canvases first.
  return items
    .map(t => ({ t, score: scoreCandidate(t, song, artist, durationMs) }))
    .sort((a, b) => b.score - a.score)
    .map(x => x.t);
}

function firstCanvasUrl(data) {
  return data?.canvasesList?.[0]?.canvasUrl || null;
}

async function getCanvasCached(trackId) {
  const cached = canvasCache.get(trackId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const data = await getCanvases(`spotify:track:${trackId}`);
  const has = data && data.canvasesList && data.canvasesList.length > 0;
  canvasCache.set(trackId, {
    data: has ? data : null,
    expiresAt: Date.now() + (has ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  });
  return has ? data : null;
}

async function resolveTrackId(song, artist, album, durationMs) {
  const key = lookupKey(song, artist, album);
  const cached = trackIdCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    // Cache hit: return the trackId with data from canvasCache
    const canvasData = canvasCache.get(cached.trackId);
    if (canvasData && canvasData.expiresAt > Date.now()) {
      return { trackId: cached.trackId, data: canvasData.data };
    }
  }

  const tracks = await searchTracks(song, artist, album, durationMs);
  for (const t of tracks) {
    if (!t?.id) continue;
    const data = await getCanvasCached(t.id);
    if (data) {
      trackIdCache.set(key, { trackId: t.id, expiresAt: Date.now() + POSITIVE_TTL_MS });
      return { trackId: t.id, data };
    }
  }
  trackIdCache.set(key, { trackId: null, expiresAt: Date.now() + NEGATIVE_TTL_MS });
  return null;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const fetchCanvas = async (req, res) => {
  let { trackId, trackIds, song, artist, album, durationMs } = req.query;

  let ids = [];
  if (trackId) ids.push(trackId);
  if (trackIds) ids = ids.concat(trackIds.split(',').map(s => s.trim()).filter(Boolean));

  // ----- song/artist/album resolver -----
  if (ids.length === 0 && (song || artist || album)) {
    const resolved = await resolveTrackId(song, artist, album, Number(durationMs) || null);
    if (resolved) {
      const url = firstCanvasUrl(resolved.data);
      return res.json({
        success: true,
        url,
        canvasUrl: url,
        trackId: resolved.trackId,
        trackUri: `spotify:track:${resolved.trackId}`,
        canvasesList: resolved.data.canvasesList,
        data: resolved.data,
      });
    }
    return res.status(404).json({
      success: false,
      error: 'No Spotify track with canvas found for the given song/artist/album',
      query: { song, artist, album, durationMs },
    });
  }

  if (ids.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Missing trackId, trackIds, or song/artist/album parameters',
    });
  }

  const results = [];
  for (const id of ids) {
    const data = await getCanvasCached(id);
    if (data) results.push({ id, data });
  }

  if (results.length === 0) {
    return res.status(404).json({ success: false, error: 'No canvas found for provided track(s)' });
  }

  if (ids.length === 1) {
    const single = results[0];
    const url = firstCanvasUrl(single.data);
    return res.json({
      success: true,
      url,
      canvasUrl: url,
      trackId: single.id,
      trackUri: `spotify:track:${single.id}`,
      canvasesList: single.data.canvasesList,
      data: single.data,
    });
  }

  res.json({
    success: true,
    canvases: results.map(r => ({ trackId: r.id, ...r.data })),
  });
};

export const fetchArtistCanvas = async (req, res) => {
  const { artist, tracks, candidates } = req.body || {};
  if (!artist) {
    return res.status(400).json({ success: false, error: 'Missing artist' });
  }

  // Preferred: candidates = [{ title, artist, album, durationMs }]
  if (Array.isArray(candidates) && candidates.length) {
    for (const c of candidates) {
      const resolved = await resolveTrackId(c.title, c.artist || artist, c.album, c.durationMs);
      if (resolved) {
        const url = firstCanvasUrl(resolved.data);
        return res.json({
          success: true, url, canvasUrl: url, artist, trackId: resolved.trackId, data: resolved.data,
        });
      }
    }
  }

  // Legacy: tracks = [spotifyTrackId, ...]
  if (Array.isArray(tracks) && tracks.length) {
    for (const tid of tracks) {
      if (!tid) continue;
      const data = await getCanvasCached(tid);
      if (data) {
        const url = firstCanvasUrl(data);
        return res.json({ success: true, url, canvasUrl: url, artist, trackId: tid, data });
      }
    }
  }

  res.status(404).json({ success: false, error: 'No canvas found for artist' });
};

export const fetchAlbumCanvas = async (req, res) => {
  const { album, artist, tracks, candidates } = req.body || {};
  if (!album || !artist) {
    return res.status(400).json({ success: false, error: 'Missing album or artist' });
  }

  if (Array.isArray(candidates) && candidates.length) {
    for (const c of candidates) {
      const resolved = await resolveTrackId(c.title, c.artist || artist, c.album || album, c.durationMs);
      if (resolved) {
        const url = firstCanvasUrl(resolved.data);
        return res.json({
          success: true, url, canvasUrl: url, album, artist, trackId: resolved.trackId, data: resolved.data,
        });
      }
    }
  }

  if (Array.isArray(tracks) && tracks.length) {
    for (const tid of tracks) {
      if (!tid) continue;
      const data = await getCanvasCached(tid);
      if (data) {
        const url = firstCanvasUrl(data);
        return res.json({ success: true, url, canvasUrl: url, album, artist, trackId: tid, data });
      }
    }
  }

  // Last resort: search for the album title itself.
  const resolved = await resolveTrackId(album, artist, album);
  if (resolved) {
    const url = firstCanvasUrl(resolved.data);
    return res.json({
      success: true, url, canvasUrl: url, album, artist, trackId: resolved.trackId, data: resolved.data,
    });
  }

  res.status(404).json({ success: false, error: 'No canvas found for album' });
};
