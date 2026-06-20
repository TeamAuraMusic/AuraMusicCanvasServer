/**
 * Spotify search service.
 *
 * Uses the standard Spotify Web API at api.spotify.com/v1/search.
 *
 * Why this endpoint:
 *   - It's the official, documented, and stable search API
 *   - The TOTP-based access token from open.spotify.com/api/token is a
 *     standard JWT Bearer token that works with api.spotify.com
 *   - The previous spclient searchview endpoint (km/v4) broke after a
 *     Spotify internal API update (returns 400)
 *   - Unlike the internal spclient endpoints, the standard API doesn't
 *     change without developer notice
 *
 * Rate limiting: the standard API allows ~180 requests/minute per token.
 * Our canvas server only searches when resolving canvas URLs (not on every
 * playback), so we stay well within limits.
 */

import axios from 'axios';
import { getToken } from './spotifyAuthService.js';

const SEARCH_URL = 'https://api.spotify.com/v1/search';

function normalize(item) {
  if (!item?.id) return null;
  return {
    id: item.id,
    uri: `spotify:track:${item.id}`,
    name: item.name,
    artists: (item.artists || []).map(a => ({ name: a.name, id: a.id })),
    duration_ms: item.duration_ms,
    album: item.album ? { name: item.album.name, id: item.album.id } : null,
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

    const res = await axios.get(SEARCH_URL, {
      params: {
        q: query.trim(),
        type: 'track',
        limit,
        market: 'US',
      },
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
      validateStatus: () => true,
    });

    if (res.status === 200) {
      const hits = res.data?.tracks?.items || [];
      return hits.map(normalize).filter(Boolean);
    }

    // Log details for debugging
    const bodyPreview = JSON.stringify(res.data).slice(0, 300);
    console.warn(`[search] api.spotify.com status=${res.status} body=${bodyPreview}`);
    return [];
  } catch (err) {
    console.error('[search] error:', err.response?.status, err.response?.data || err.message);
    return [];
  }
}
