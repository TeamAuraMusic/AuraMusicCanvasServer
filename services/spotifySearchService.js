/**
 * Spotify search service.
 *
 * Resolution path: `spclient.wg.spotify.com/searchview/km/v4/search/<query>`.
 *
 * Why this endpoint vs. the obvious alternatives:
 *   - api.spotify.com/v1/search is rate-limited per IP and Render's shared
 *     egress IPs hit HTTP 429 immediately. Unusable from a cloud host.
 *   - api-partner.spotify.com/pathfinder requires a `client-token` minted via
 *     a protobuf-only endpoint plus a rotating persistedQuery sha256 hash –
 *     fragile and complex.
 *   - searchview is the same Spotify-internal search the mobile/web clients
 *     use. It accepts the EXACT same mobile-web-player Bearer token we already
 *     mint for the canvaz endpoint, returns rich JSON, has high per-IP limits,
 *     and needs no extra credentials.
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
        catalogue: 'premium',
        country: 'US',
        locale: 'en',
        platform: 'web',
      },
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Accept-Language': 'en',
        'User-Agent': 'Spotify/9.0.34.593 iOS/18.4 (iPhone15,3)',
      },
      validateStatus: () => true,
    });
    if (res.status !== 200) {
      console.warn('[search] non-200', res.status, JSON.stringify(res.data).slice(0, 200));
      return [];
    }
    const hits = res.data?.results?.tracks?.hits || [];
    return hits.map(normalize).filter(Boolean);
  } catch (err) {
    console.error('[search] error:', err.response?.status, err.response?.data || err.message);
    return [];
  }
}
