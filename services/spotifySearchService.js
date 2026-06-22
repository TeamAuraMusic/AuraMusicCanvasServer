/**
 * Spotify search service.
 *
 * The previous `spclient.wg.spotify.com/searchview/km/v4/search` path now
 * returns HTTP 400 with an empty body from Render and local Node, so Canvas
 * lookups by song/artist could never resolve a Spotify track ID. Use the
 * current Spotify web-player Pathfinder GraphQL search operation instead.
 */

import axios from 'axios';
import { getToken } from './spotifyAuthService.js';

const PATHFINDER_URL = 'https://api-partner.spotify.com/pathfinder/v1/query';
const FIND_TRACKS_HASH = '755858df4daab8d212980b02a81dcf8c9a58447de318b59d07c4651a1d0450b9';

function normalize(item) {
  const track = item?.item?.data || item?.data || item;
  const uri = track?.uri;
  if (!uri || !uri.startsWith('spotify:track:')) return null;
  const id = uri.split(':').pop();
  const artistItems = track.artists?.items || [];
  const album = track.albumOfTrack || track.album;
  return {
    id,
    uri,
    name: track.name,
    artists: artistItems.map(a => ({
      name: a.profile?.name || a.name,
      id: (a.uri || '').split(':').pop() || a.id,
    })).filter(a => a.name),
    duration_ms: track.duration?.totalMilliseconds || track.duration_ms || track.duration,
    album: album ? {
      name: album.name,
      id: (album.uri || '').split(':').pop() || album.id,
    } : null,
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

    const res = await axios.post(
      PATHFINDER_URL,
      {
        operationName: 'findTracks',
        variables: {
          query: query.trim(),
          limit,
          offset: 0,
        },
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: FIND_TRACKS_HASH,
          },
        },
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'app-platform': 'WebPlayer',
          'Spotify-App-Version': '1.2.62.318.g83f5768a',
          'Origin': 'https://open.spotify.com/',
          'Referer': 'https://open.spotify.com/',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        validateStatus: () => true,
      },
    );

    if (res.status !== 200) {
      const bodyPreview = JSON.stringify(res.data).slice(0, 300);
      console.warn(`[search] non-200 ${res.status}: ${bodyPreview}`);
      return [];
    }

    const hits = res.data?.data?.searchV2?.tracksV2?.items || [];
    return hits.map(normalize).filter(Boolean);
  } catch (err) {
    console.error('[search] error:', err.response?.status, err.response?.data || err.message);
    return [];
  }
}
