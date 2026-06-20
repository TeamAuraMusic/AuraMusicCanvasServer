/**
 * Spotify search service.
 *
 * Uses spclient.wg.spotify.com/searchview/km/v4 with the same Bearer token
 * that works for canvas fetches.
 *
 * Working implementation verified from:
 *   - ignatij/spotpilot (Go) — searchview with app-platform header
 *   - stieterd/playlist-generator (Python) — full header set
 *   - slowdownify README — confirms endpoint is NOT deprecated
 *
 * Key requirements for the 400 → 200 fix:
 *   1. app-platform: WebPlayer header (missing in our original code)
 *   2. catalogue= (empty, NOT "premium")
 *   3. imageSize parameter
 *   4. Spotify-App-Version header
 */

import axios from 'axios';
import { getToken } from './spotifyAuthService.js';

const SEARCH_URL_BASE = 'https://spclient.wg.spotify.com/searchview/km/v4/search/';

function normalize(item) {
  const uri = item?.uri;
  if (!uri || !uri.startsWith('spotify:track:')) return null;
  const id = uri.split(':').pop();
  return {
    id,
    uri,
    name: item.name,
    artists: (item.artists || []).map(a => ({ name: a.name, id: (a.uri || '').split(':').pop() })),
    duration_ms: item.duration,
    album: item.album ? { name: item.album.name, id: (item.album.uri || '').split(':').pop() } : null,
  };
}

/**
 * Best-effort track search. Returns an array of
 * `{ id, uri, name, artists, duration_ms, album }`.
 */
export async function searchSpotifyTracks(query, limit = 10) {
  if (!query || !query.trim()) return [];

  try {
    const accessToken = await getToken('transport', 'mobile-web-player');
    if (!accessToken) {
      console.error('[search] no access token returned');
      return [];
    }

    const res = await axios.get(SEARCH_URL_BASE + encodeURIComponent(query.trim()), {
      params: {
        entityVersion: 2,
        limit,
        imageSize: 'large',
        catalogue: '',
        country: 'US',
        locale: 'en',
        platform: 'web',
      },
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Accept-Language': 'en',
        'app-platform': 'WebPlayer',
        'Spotify-App-Version': '1.2.62.318.g83f5768a',
        'Origin': 'https://open.spotify.com/',
        'Referer': 'https://open.spotify.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Not A(Brand";v="8", "Chromium";v="131", "Google Chrome";v="131"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
      },
      validateStatus: () => true,
    });

    if (res.status !== 200) {
      const bodyPreview = JSON.stringify(res.data).slice(0, 300);
      console.warn(`[search] non-200 ${res.status}: ${bodyPreview}`);
      return [];
    }

    const hits = res.data?.results?.tracks?.hits || [];
    return hits.map(normalize).filter(Boolean);
  } catch (err) {
    console.error('[search] error:', err.response?.status, err.response?.data || err.message);
    return [];
  }
}
