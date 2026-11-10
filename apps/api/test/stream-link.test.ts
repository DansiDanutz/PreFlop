import { describe, expect, it } from 'vitest';
import { parseStreamLink } from '../src/lib/streamLink.ts';

/** A manual table's live stream: a YouTube video/live id or a Twitch channel, never an arbitrary URL. */
describe('parseStreamLink', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=30', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('reads a YouTube link: %s', (url, id) => {
    expect(parseStreamLink(url)).toEqual({ provider: 'youtube', id });
  });

  it.each([
    ['https://www.twitch.tv/preflop_table1', 'preflop_table1'],
    ['https://twitch.tv/PreflopLive/', 'prefloplive'],
  ])('reads a Twitch channel: %s', (url, id) => {
    expect(parseStreamLink(url)).toEqual({ provider: 'twitch', id });
  });

  it.each([
    'http://www.youtube.com/watch?v=dQw4w9WgXcQ', // not https
    'https://evil.example/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ"><script>',
    'https://www.youtube.com/embed/live_stream?channel=UC123', // a channel slot, not a video id
    'https://www.twitch.tv/videos/123456789', // a recording, not a live channel
    'https://www.twitch.tv/ab', // too short for a channel name
    'https://www.twitch.tv/a-b-c-d',
    'javascript:alert(1)',
    'not a url',
    '',
  ])('refuses %s', (url) => {
    expect(parseStreamLink(url)).toBeNull();
  });
});
