import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createClient } from './index.ts';

function respond(status: number, body: string) {
  const fetchMock = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

async function apiError(p: Promise<unknown>): Promise<ApiError> {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(ApiError);
  return e as ApiError;
}

describe('news', () => {
  const card = { id: 'news_1', slug: 'tournaments-are-live', title: 'Tournaments are live', summary: 'Free chips.', tags: ['tournaments'], published_at: '2026-10-03T00:00:00Z' };

  it('lists posts with the query string and reads one by slug', async () => {
    const f = respond(200, JSON.stringify({ posts: [card] }));
    const c = createClient({ baseUrl: 'https://api.test' });
    expect((await c.newsList({ limit: 3, tag: 'tournaments' })).posts[0]!.slug).toBe('tournaments-are-live');
    expect((f.mock.calls[0] as unknown[])[0]).toBe('https://api.test/v1/news?limit=3&tag=tournaments');
    respond(200, JSON.stringify({ ...card, body: '## Hi', updated_at: '2026-10-03T00:00:00Z' }));
    expect((await c.newsPost('tournaments-are-live')).body).toBe('## Hi');
  });

  it('refuses a post list that is not the expected shape', async () => {
    respond(200, JSON.stringify({ posts: [{ ...card, slug: '../etc' }] }));
    expect((await apiError(createClient({ baseUrl: 'https://api.test' }).newsList())).type).toBe('invalid_response');
    respond(200, JSON.stringify({ posts: 'none' }));
    expect((await apiError(createClient({ baseUrl: 'https://api.test' }).newsList())).type).toBe('invalid_response');
  });

  it('admin calls use the right verbs and paths', async () => {
    const post = { ...card, body: '', status: 'draft', published_at: null, author_id: 'u1', created_at: card.published_at, updated_at: card.published_at };
    const f = respond(200, JSON.stringify(post));
    const c = createClient({ baseUrl: 'https://api.test' });
    await c.adminUpdateNews('news_1', { title: 'New title' });
    expect((f.mock.calls[0] as unknown[])[1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ title: 'New title' }) });
    await c.adminPublishNews('news_1');
    expect((f.mock.calls[1] as unknown[])[0]).toBe('https://api.test/v1/admin/news/news_1/publish');
    respond(200, JSON.stringify({ ...post, status: 'live' }));
    expect((await apiError(c.adminUnpublishNews('news_1'))).type).toBe('invalid_response');
  });
});
