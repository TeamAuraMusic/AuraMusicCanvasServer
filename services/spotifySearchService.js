/**
 * Spotify search service.
 *
 * Uses the Spotify Pathfinder GraphQL endpoint (same one the web player uses)
 * to search for tracks. This is the most reliable internal endpoint and has
 * high per-IP limits when authenticated with a valid client+access token pair.
 *
 * Previous approach (spclient.wg.spotify.com/searchview/km/v4) broke when
 * Spotify updated their internal API. Pathfinder has been stable for years.
 */

import axios from 'axios';
import { getToken } from './spotifyAuthService.js';

const CLIENT_TOKEN_URL = 'https://clienttoken.spotify.com/v1/clienttoken';
const PATHFINDER_URL = 'https://api-partner.spotify.com/pathfinder/v1/query';

// Stable client ID used by the Spotify web player (public, not secret).
const WEB_PLAYER_CLIENT_ID = 'd8a5ed958d274c2e8ee717e6a4b0971d';
const WEB_PLAYER_CLIENT_VERSION = '1.2.62.318.g83f5768a';

// Client-token cache (Spotify's client tokens last ~1 hour).
let clientTokenCache = { token: null, expiresAt: 0 };

// Search persisted query hash – stable across web player versions for now.
// This is a known-good hash for the search operation.
const SEARCH_QUERY_HASH = '46ec0ea5099d3ec9be73cd9c4ed793c8b8ae38878a00e24c7a3f286726aa8e0c';

/**
 * Obtain a Spotify client token. These are separate from user access tokens
 * and identify the client application itself. Required by Pathfinder.
 */
async function getClientToken() {
  const now = Date.now();
  if (clientTokenCache.token && clientTokenCache.expiresAt > now) {
    return clientTokenCache.token;
  }

  try {
    const res = await axios.post(CLIENT_TOKEN_URL, JSON.stringify({
      client_data: {
        client_version: WEB_PLAYER_CLIENT_VERSION,
        client_id: WEB_PLAYER_CLIENT_ID,
        js_sdk_data: {},
      },
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Spotify/9.0.34.593 iOS/18.4 (iPhone15,3)',
      },
    });

    const token = res.data?.granted_token?.token;
    const expiresIn = (res.data?.granted_token?.expires_in || 3600) * 1000;
    if (token) {
      clientTokenCache = { token, expiresAt: now + expiresIn - 60_000 };
      console.log('[search] client token acquired');
      return token;
    }
  } catch (err) {
    console.error('[search] client token error:', err.message);
  }
  return null;
}

function normalize(item) {
  const uri = item?.uri;
  if (!uri || !uri.startsWith('spotify:track:')) return null;
  const id = uri.split(':').pop();
  return {
    id,
    uri,
    name: item.name,
    artists: (item.artists || []).map(a => ({ name: a.name, id: (a.uri || '').split(':').pop() })),
    duration_ms: item.duration_ms || item.duration,
    album: item.album ? { name: item.album.name, id: (item.album.uri || '').split(':').pop() } : null,
  };
}

/**
 * Search via the Pathfinder GraphQL endpoint.
 */
async function searchViaPathfinder(query, accessToken, clientToken, limit) {
  const variables = {
    searchTerm: query,
    offset: 0,
    limit,
    includeAudiobooks: false,
    includePodcasts: false,
  };

  const extensions = {
    persistedQuery: {
      version: 1,
      sha256Hash: SEARCH_QUERY_HASH,
    },
  };

  const res = await axios.post(
    PATHFINDER_URL,
    { variables, extensions },
    {
      params: { operationName: 'searchDesktop' },
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Client-Token': clientToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://open.spotify.com/',
        'Referer': 'https://open.spotify.com/',
      },
      validateStatus: () => true,
    }
  );

  if (res.status !== 200) {
    console.warn('[search:pathfinder] non-200', res.status, JSON.stringify(res.data).slice(0, 300));
    return [];
  }

  // Pathfinder returns search results in sections
  const data = res.data?.data?.searchV2;
  if (!data) {
    console.warn('[search:pathfinder] no searchV2 in response');
    return [];
  }

  // Extract tracks from the sections
  const sections = data.sections?.items || [];
  const trackSection = sections.find(s => s.__typename === 'SearchSection' && s.sectionType === 'QUERY_TOP_HITS')
    || sections.find(s => s.__typename === 'SearchSection');
  if (!trackSection) return [];

  const items = trackSection.content?.items || [];
  return items
    .map(item => {
      const track = item.itemV2?.data || item.data || item;
      if (!track?.uri?.startsWith('spotify:track:')) return null;
      return {
        id: track.uri.split(':').pop(),
        uri: track.uri,
        name: track.name || track.title,
        artists: (track.artists?.items || track.artists || []).map(a => {
          const data = a.data || a;
          return { name: data.name, id: (data.uri || '').split(':').pop() };
        }),
        duration_ms: track.duration?.totalMilliseconds || track.duration_ms || 0,
        album: track.album ? { name: track.album.name || track.album.title, id: (track.album.uri || '').split(':').pop() } : null,
      };
    })
    .filter(Boolean);
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

    const clientToken = await getClientToken();
    if (!clientToken) {
      console.error('[search] no client token returned');
      return [];
    }

    const results = await searchViaPathfinder(query, accessToken, clientToken, limit);
    if (results.length > 0) return results;

    // Fallback: try legacy searchview endpoint
    console.log('[search] pathfinder returned 0 results, trying legacy endpoint');
    return await searchLegacy(query, accessToken, limit);
  } catch (err) {
    console.error('[search] error:', err.response?.status, err.response?.data || err.message);
    return [];
  }
}

/**
 * Legacy fallback: the old spclient searchview endpoint.
 */
async function searchLegacy(query, accessToken, limit) {
  const SEARCH_URL = 'https://spclient.wg.spotify.com/searchview/v2/search/';
  try {
    const res = await axios.get(SEARCH_URL + encodeURIComponent(query.trim()), {
      params: {
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
      console.warn('[search:legacy] non-200', res.status);
      return [];
    }
    const hits = res.data?.results?.tracks?.hits || [];
    return hits.map(normalize).filter(Boolean);
  } catch (err) {
    console.error('[search:legacy] error:', err.message);
    return [];
  }
}
