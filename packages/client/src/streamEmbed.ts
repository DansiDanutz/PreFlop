import type { StreamLink } from './index.ts';

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const TWITCH_CHANNEL = /^[a-z0-9_]{4,25}$/;

/**
 * The iframe address for a table's live stream (migration 032). Built here from the id alone, so a
 * table can only ever frame a YouTube or Twitch player. Muted so browsers allow autoplay. Twitch
 * refuses to play unless `parent` names the page's host.
 */
export function streamEmbedUrl(stream: StreamLink | null | undefined, parentHost: string): string | null {
  if (!stream) return null;
  if (stream.provider === 'youtube' && YOUTUBE_ID.test(stream.id)) {
    return `https://www.youtube-nocookie.com/embed/${stream.id}?autoplay=1&mute=1&playsinline=1&rel=0`;
  }
  if (stream.provider === 'twitch' && TWITCH_CHANNEL.test(stream.id)) {
    const q = new URLSearchParams({ channel: stream.id, parent: parentHost, muted: 'true', autoplay: 'true' });
    return `https://player.twitch.tv/?${q.toString()}`;
  }
  return null;
}
