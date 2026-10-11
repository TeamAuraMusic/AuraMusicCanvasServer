import axios from 'axios';
import { getCanvases } from '../services/spotifyCanvasService.js';
import { getToken } from '../services/spotifyAuthService.js';
import { searchSpotifyTracks } from '../services/spotifySearchService.js';

// KV-backed cache (Cloudflare Workers + local fallback)
// ---------------------------------------------------------------------------
const POSITIVE_TTL_SEC = 24 * 60 * 60; // 24h
const NEGATIVE_TTL_SEC = 60 * 60;      // 1h
const POSITIVE_TTL_MS = POSITIVE_TTL_SEC * 1000;
const NEGATIVE_TTL_MS = NEGATIVE_TTL_SEC * 1000;

const KV = globalThis.CANVAS_CACHE || globalThis.__ENV?.CANVAS_CACHE;

// key -> { trackId, expiresAt }
const trackIdCacheMem = new Map();
// trackId -> { data | null, expiresAt }
const canvasCacheMem = new Map();

async function kvGet(key) {
  if (!KV || typeof KV.get !== 'function') return null;
  try {
    const val = await KV.get(key);
    return val ? JSON.parse(val) : null;
  } catch (e) {
    console.warn('[kv] get failed:', e?.message);
    return null;
  }
}

async function kvSet(key, value, ttlSec) {
  if (!KV || typeof KV.put !== 'function') return;
  try {
    await KV.put(key, JSON.stringify(value), ttlSec ? { expirationTtl: ttlSec } : undefined);
  } catch (e) {
    console.warn('[kv] set failed:', e?.message);
  }
}

function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\([^)]*\)|\[[^\]]*]/g, ' ')
    .replace(/\b(remaster(ed)?|live|explicit|official\s*video|lyrics?|audio|hd|hq|feat\.?|ft\.?|with)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function artistNorm(s) {
  return norm(s).replace(/^the\s+/, '').trim();
}

function splitArtistNames(s) {
  return (s || '')
    .split(/\s*(?:,|&|\band\b|\bfeat\.?|\bft\.?|\bwith\b)\s*/i)
    .map(artistNorm)
    .filter(Boolean);
}

function tokenSet(s) {
  return new Set(norm(s).split(' ').filter(t => t.length > 1));
}

function containsAll(haystack, needles) {
  for (const needle of needles) {
    if (!haystack.has(needle)) return false;
  }
  return true;
}

function titleMatches(candidate, query) {
  const c = norm(candidate);
  const q = norm(query);
  if (!c || !q) return false;
  if (c === q) return true;

  const cTokens = tokenSet(c);
  const qTokens = tokenSet(q);
  if (!cTokens.size || !qTokens.size) return false;

  // Avoid broad one-word partial matches. "Home" should not match every
  // unrelated song title containing the word "home".
  return qTokens.size > 1 && containsAll(cTokens, qTokens);
}

function artistNameMatches(candidate, query) {
  const c = artistNorm(candidate);
  const q = artistNorm(query);
  if (!c || !q) return false;
  if (c === q) return true;

  const cTokens = tokenSet(c);
  const qTokens = tokenSet(q);
  if (cTokens.size < 2 || qTokens.size < 2) return false;

  return containsAll(cTokens, qTokens) || containsAll(qTokens, cTokens);
}

function artistMatches(candidateArtists, requestedArtist) {
  if (!requestedArtist) return true;
  const requested = splitArtistNames(requestedArtist);
  if (!requested.length) return true;
  const candidates = Array.isArray(candidateArtists)
    ? candidateArtists.map(a => a?.name || a).filter(Boolean)
    : splitArtistNames(candidateArtists);

  return candidates.some(candidate =>
    requested.some(query => artistNameMatches(candidate, query))
  );
}

function canvasMatchesArtist(data, requestedArtist) {
  if (!requestedArtist) return true;
  const canvasArtists = (data?.canvasesList || [])
    .map(c => c?.artist?.artistName)
    .filter(Boolean);
  return canvasArtists.length === 0 || artistMatches(canvasArtists, requestedArtist);
}

function lookupKey(song, artist, album, durationMs) {
  return [norm(song), norm(artist), norm(album), durationMs || ''].join('\u0001');
}

function scoreCandidate(track, song, artist, durationMs) {
  let score = 0;
  const nSong = norm(song);
  const nArtist = norm(artist);
  if (nSong && norm(track.name) === nSong) score += 4;
  else if (nSong && titleMatches(track.name, song)) score += 2;

  if (nArtist) {
    if (artistMatches(track.artists || [], artist)) score += 3;
  }

  if (durationMs && track.duration_ms) {
    const diff = Math.abs(track.duration_ms - durationMs);
    if (diff <= 2_000) score += 2;
    else if (diff <= 5_000) score += 1;
  }
  return score;
}

function isEligibleCandidate(track, song, artist) {
  if (!track?.id) return false;
  if (song && !titleMatches(track.name, song)) return false;
  if (artist && !artistMatches(track.artists || [], artist)) return false;
  return true;
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
  const scored = items
    .filter(t => isEligibleCandidate(t, song, artist))
    .map(t => ({ t, score: scoreCandidate(t, song, artist, durationMs) }))
    .sort((a, b) => b.score - a.score);

  return scored.map(x => x.t);
}

function firstCanvasUrl(data) {
  return data?.canvasesList?.[0]?.canvasUrl || null;
}

async function getCanvasCached(trackId) {
  const k = `canvas:${trackId}`;
  const mem = canvasCacheMem.get(trackId);
  if (mem && mem.expiresAt > Date.now()) return mem.data;
  const kv = await kvGet(k);
  if (kv && kv.expiresAt > Date.now()) {
    canvasCacheMem.set(trackId, kv);
    return kv.data;
  }
  const data = await getCanvases(`spotify:track:${trackId}`);
  const has = data && data.canvasesList && data.canvasesList.length > 0;
  const val = { data: has ? data : null, expiresAt: Date.now() + (has ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) };
  canvasCacheMem.set(trackId, val);
  await kvSet(k, val, has ? POSITIVE_TTL_SEC : NEGATIVE_TTL_SEC);
  return has ? data : null;
}

async function resolveTrackId(song, artist, album, durationMs) {
  const key = lookupKey(song, artist, album, durationMs);
  const cachedMem = trackIdCacheMem.get(key);
  if (cachedMem && cachedMem.expiresAt > Date.now()) {
    const c = canvasCacheMem.get(cachedMem.trackId);
    if (c && c.expiresAt > Date.now()) {
      return { trackId: cachedMem.trackId, data: c.data };
    }
  }
  const cachedKv = await kvGet(`tid:${key}`);
  if (cachedKv && cachedKv.expiresAt > Date.now()) {
    trackIdCacheMem.set(key, cachedKv);
    if (cachedKv.trackId) {
      const ckv = await kvGet(`canvas:${cachedKv.trackId}`);
      if (ckv && ckv.expiresAt > Date.now()) {
        canvasCacheMem.set(cachedKv.trackId, ckv);
        return { trackId: cachedKv.trackId, data: ckv.data };
      }
    }
  }

  const tracks = await searchTracks(song, artist, album, durationMs);
  for (const t of tracks) {
    if (!t?.id) continue;
    const data = await getCanvasCached(t.id);
    if (data && canvasMatchesArtist(data, artist)) {
      const tidv = { trackId: t.id, expiresAt: Date.now() + POSITIVE_TTL_MS };
      trackIdCacheMem.set(key, tidv);
      await kvSet(`tid:${key}`, tidv, POSITIVE_TTL_SEC);
      return { trackId: t.id, data };
    }
  }
  const tidn = { trackId: null, expiresAt: Date.now() + NEGATIVE_TTL_MS };
  trackIdCacheMem.set(key, tidn);
  await kvSet(`tid:${key}`, tidn, NEGATIVE_TTL_SEC);
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
