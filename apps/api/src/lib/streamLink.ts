/**
 * A manual table's live stream (docs/19): the webcam over the table, broadcast on YouTube or Twitch
 * and embedded in the player's table page. Only a video id or a channel name is kept, never the URL
 * the operator pasted, so the player page builds the embed itself and nothing else can be framed.
 */
export type StreamLink = { provider: 'youtube'; id: string } | { provider: 'twitch'; id: string };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const TWITCH_CHANNEL = /^[A-Za-z0-9_]{4,25}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const TWITCH_HOSTS = new Set(['twitch.tv', 'www.twitch.tv', 'm.twitch.tv']);
/** Twitch paths that are pages, not channels. */
const TWITCH_RESERVED = new Set(['videos', 'directory', 'settings', 'search', 'downloads', 'jobs', 'p']);

function youtubeId(u: URL): string | null {
  if (u.hostname === 'youtu.be') return u.pathname.split('/')[1] ?? null;
  if (!YOUTUBE_HOSTS.has(u.hostname)) return null;
  if (u.pathname === '/watch') return u.searchParams.get('v');
  const [, first, second] = u.pathname.split('/');
  return first === 'live' || first === 'embed' ? (second ?? null) : null;
}

function twitchChannel(u: URL): string | null {
  if (!TWITCH_HOSTS.has(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length !== 1 || TWITCH_RESERVED.has(parts[0]!.toLowerCase())) return null;
  return parts[0]!;
}

/** The stream stored on a table row (migration 032), or null when it has none. */
export function storedStream(t: { stream_provider: string | null; stream_id: string | null }): StreamLink | null {
  if (!t.stream_id || (t.stream_provider !== 'youtube' && t.stream_provider !== 'twitch')) return null;
  return { provider: t.stream_provider, id: t.stream_id };
}

/** The stream behind a pasted link, or null when it is not an https YouTube video or Twitch channel. */
export function parseStreamLink(raw: string): StreamLink | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const yt = youtubeId(u);
  // /embed/live_stream?channel=… is a channel's live slot, not a video: unsupported, and 11 characters long.
  if (yt !== null) return YOUTUBE_ID.test(yt) && yt !== 'live_stream' ? { provider: 'youtube', id: yt } : null;
  const tw = twitchChannel(u);
  if (tw !== null && TWITCH_CHANNEL.test(tw)) return { provider: 'twitch', id: tw.toLowerCase() };
  return null;
}
