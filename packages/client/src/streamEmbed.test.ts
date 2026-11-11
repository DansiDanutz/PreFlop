import { describe, expect, it } from 'vitest';
import { streamEmbedUrl } from './streamEmbed.ts';

describe('streamEmbedUrl', () => {
  it('embeds a YouTube stream from the privacy-enhanced domain, muted and inline', () => {
    const u = new URL(streamEmbedUrl({ provider: 'youtube', id: 'dQw4w9WgXcQ' }, 'preflop.app')!);
    expect(u.origin).toBe('https://www.youtube-nocookie.com');
    expect(u.pathname).toBe('/embed/dQw4w9WgXcQ');
    expect(u.searchParams.get('autoplay')).toBe('1');
    expect(u.searchParams.get('mute')).toBe('1');
    expect(u.searchParams.get('playsinline')).toBe('1');
  });

  it('embeds a Twitch channel with the page host as parent (Twitch requires it)', () => {
    const u = new URL(streamEmbedUrl({ provider: 'twitch', id: 'preflop_table' }, 'staging.preflop.app')!);
    expect(u.origin).toBe('https://player.twitch.tv');
    expect(u.searchParams.get('channel')).toBe('preflop_table');
    expect(u.searchParams.get('parent')).toBe('staging.preflop.app');
    expect(u.searchParams.get('muted')).toBe('true');
  });

  it('builds nothing from an id that is not a plain video id or channel name', () => {
    expect(streamEmbedUrl({ provider: 'youtube', id: '../evil?x=' }, 'preflop.app')).toBeNull();
    expect(streamEmbedUrl({ provider: 'twitch', id: 'a&parent=evil.example' }, 'preflop.app')).toBeNull();
    expect(streamEmbedUrl({ provider: 'other' as 'youtube', id: 'dQw4w9WgXcQ' }, 'preflop.app')).toBeNull();
    expect(streamEmbedUrl(null, 'preflop.app')).toBeNull();
  });
});
