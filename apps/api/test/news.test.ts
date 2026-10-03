import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '../src/lib/audit.ts';
import { tx } from '../src/lib/db.ts';
import { slugify } from '../src/routes/news.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, harness } from './helpers.ts';

/** News posts (migration 015): public reading, and writing by the PreFlop team. */
let h: Harness;
let admin: string;
let player: string;
let ops: string;
let support: string;

async function staff(role: 'ops' | 'support') {
  const p = await h.register(role);
  await h.db.query('update users set platform_role = $2 where id = $1', [p.id, role]);
  return p.token;
}

beforeAll(async () => {
  h = await harness('news');
  await tx(h.db, (c) => seedAdmin(c, 'news-admin@test.dev', 'admin-pass-1'));
  admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'news-admin@test.dev', password: 'admin-pass-1' })).body.token;
  player = (await h.register('Reader')).token;
  ops = await staff('ops');
  support = await staff('support');
});
afterAll(async () => h?.close());

describe('slugify', () => {
  it('makes lowercase hyphenated ASCII slugs', () => {
    expect(slugify('Tournaments are live (free chips)')).toBe('tournaments-are-live-free-chips');
    expect(slugify('  Crème brûlée & Café!  ')).toBe('creme-brulee-and-cafe');
    expect(slugify('!!!')).toBe('post');
    expect(slugify('a'.repeat(200)).length).toBe(80);
    expect(slugify(`${'word '.repeat(30)}`)).not.toMatch(/-$/);
  });
});

describe('public news', () => {
  it('lists the launch posts, newest first, without bodies', async () => {
    const r = await h.api('GET', '/v1/news');
    expect(r.status).toBe(200);
    const slugs = r.body.posts.map((p: any) => p.slug);
    expect(slugs).toEqual(['tournaments-are-live', 'security-and-responsible-play-upgrades', 'markets-rulebook-42-markets', 'partner-widget-customization']);
    for (const p of r.body.posts) {
      expect(p.body).toBeUndefined();
      expect(p.author_id).toBeUndefined();
      expect(typeof p.published_at).toBe('string');
    }
  });

  it('filters by tag and limits', async () => {
    const t = await h.api('GET', '/v1/news?tag=partners');
    expect(t.body.posts.map((p: any) => p.slug)).toEqual(['partner-widget-customization']);
    expect((await h.api('GET', '/v1/news?limit=2')).body.posts).toHaveLength(2);
    expect((await h.api('GET', '/v1/news?tag=nothing-here')).body.posts).toEqual([]);
  });

  it('refuses garbage queries with 400', async () => {
    for (const q of ['limit=abc', 'limit=0', 'limit=51', 'limit=1.5', 'tag=%3Cscript%3E', 'tag=UPPER', `tag=${'a'.repeat(40)}`]) {
      const r = await h.api('GET', `/v1/news?${q}`);
      expect(r.status, q).toBe(400);
      expect(r.body.type).toBe('bad_request');
    }
  });

  it('reads one post by slug; unknown or malformed slugs are 404', async () => {
    const r = await h.api('GET', '/v1/news/tournaments-are-live');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ slug: 'tournaments-are-live', title: 'Tournaments are live (free chips)' });
    expect(r.body.body).toContain('Free chips have no cash value');
    expect((await h.api('GET', '/v1/news/no-such-post')).status).toBe(404);
    expect((await h.api('GET', '/v1/news/Bad%20Slug')).status).toBe(404);
  });

  it('launch posts never claim real money is available', async () => {
    const all = await Promise.all(['tournaments-are-live', 'security-and-responsible-play-upgrades', 'markets-rulebook-42-markets', 'partner-widget-customization']
      .map((s) => h.api('GET', `/v1/news/${s}`)));
    for (const r of all) {
      expect(r.body.body).not.toMatch(/real money is (now )?(live|available|on)\b/i);
      expect(r.body.body).not.toMatch(/guarantee/i);
    }
  });
});

describe('news administration', () => {
  it('is for admin and ops only', async () => {
    expect((await h.api('GET', '/v1/admin/news')).status).toBe(401);
    expect((await h.api('GET', '/v1/admin/news', player)).status).toBe(403);
    expect((await h.api('GET', '/v1/admin/news', support)).status).toBe(403);
    expect((await h.api('POST', '/v1/admin/news', support, { title: 'Nope' })).status).toBe(403);
    expect((await h.api('GET', '/v1/admin/news', ops)).status).toBe(200);
  });

  it('creates drafts with a unique slug from the title, hidden from the public', async () => {
    const a = await h.api('POST', '/v1/admin/news', admin, { title: 'Club onboarding guide', summary: 'How certification works.', body: 'Hello **clubs**.', tags: ['clubs'] });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ slug: 'club-onboarding-guide', status: 'draft', published_at: null, tags: ['clubs'] });
    const b = await h.api('POST', '/v1/admin/news', ops, { title: 'Club onboarding guide' });
    expect(b.status).toBe(201);
    expect(b.body.slug).toBe('club-onboarding-guide-2');

    expect((await h.api('GET', '/v1/news/club-onboarding-guide')).status).toBe(404);
    expect((await h.api('GET', '/v1/news?tag=clubs')).body.posts).toEqual([]);
    const list = (await h.api('GET', '/v1/admin/news', admin)).body.posts;
    expect(list.find((p: any) => p.id === a.body.id)).toMatchObject({ status: 'draft', body: 'Hello **clubs**.' });
  });

  it('numbers repeated long titles past -2 (the numbered slug shortens the base)', async () => {
    const title = 'l'.repeat(80);
    const slugs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await h.api('POST', '/v1/admin/news', admin, { title });
      expect(r.status).toBe(201);
      slugs.push(r.body.slug);
    }
    expect(slugs).toEqual(['l'.repeat(80), `${'l'.repeat(78)}-2`, `${'l'.repeat(78)}-3`]);
  });

  it('validates input', async () => {
    const bad = [
      { title: 'ab' },
      { title: 'x'.repeat(121) },
      { title: 'Fine title', summary: 's'.repeat(301) },
      { title: 'Fine title', body: 'b'.repeat(20_001) },
      { title: 'Fine title', tags: ['Not OK'] },
      { title: 'Fine title', tags: ['a', 'a'] },
      { title: 'Fine title', tags: Array.from({ length: 9 }, (_, i) => `t${i}`) },
      { title: 'Fine title', slug: 'Has Spaces' },
      { title: 'Fine title', status: 'published' },
    ];
    for (const body of bad) expect((await h.api('POST', '/v1/admin/news', admin, body)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    expect((await h.api('POST', '/v1/admin/news', admin, { title: 'Taken', slug: 'tournaments-are-live' })).status).toBe(409);
  });

  it('publishes, edits, unpublishes, republishes and deletes', async () => {
    const c = (await h.api('POST', '/v1/admin/news', admin, { title: 'Weekly free-chip leaderboard', summary: 'New board.', body: '## Prizes\n\nFree chips only.', tags: ['leaderboards'] })).body;
    const pub = await h.api('POST', `/v1/admin/news/${c.id}/publish`, admin);
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe('published');
    const firstDate = pub.body.published_at;

    const list = (await h.api('GET', '/v1/news')).body.posts;
    expect(list[0].slug).toBe('weekly-free-chip-leaderboard');
    expect((await h.api('GET', '/v1/news/weekly-free-chip-leaderboard')).body.body).toBe('## Prizes\n\nFree chips only.');

    const edit = await h.api('PUT', `/v1/admin/news/${c.id}`, ops, { title: 'Weekly leaderboard', slug: 'weekly-leaderboard', tags: ['leaderboards', 'players'] });
    expect(edit.status).toBe(200);
    expect(edit.body).toMatchObject({ title: 'Weekly leaderboard', slug: 'weekly-leaderboard', summary: 'New board.', tags: ['leaderboards', 'players'] });
    expect((await h.api('GET', '/v1/news/weekly-free-chip-leaderboard')).status).toBe(404);
    expect((await h.api('GET', '/v1/news/weekly-leaderboard')).status).toBe(200);
    expect((await h.api('PUT', `/v1/admin/news/${c.id}`, admin, { slug: 'tournaments-are-live' })).status).toBe(409);
    expect((await h.api('PUT', `/v1/admin/news/${c.id}`, admin, { title: 'x' })).status).toBe(400);
    expect((await h.api('PUT', '/v1/admin/news/news_missing', admin, { title: 'Missing post' })).status).toBe(404);

    expect((await h.api('POST', `/v1/admin/news/${c.id}/unpublish`, admin)).body.status).toBe('draft');
    expect((await h.api('GET', '/v1/news/weekly-leaderboard')).status).toBe(404);
    const again = await h.api('POST', `/v1/admin/news/${c.id}/publish`, admin);
    expect(again.body.published_at).toBe(firstDate);

    expect((await h.api('DELETE', `/v1/admin/news/${c.id}`, support)).status).toBe(403);
    expect((await h.api('DELETE', `/v1/admin/news/${c.id}`, admin)).body).toEqual({ ok: true });
    expect((await h.api('GET', '/v1/news/weekly-leaderboard')).status).toBe(404);
    expect((await h.api('DELETE', `/v1/admin/news/${c.id}`, admin)).status).toBe(404);
    expect((await h.api('POST', `/v1/admin/news/${c.id}/publish`, admin)).status).toBe(404);
  });

  it('audits every change on the hash chain', async () => {
    const events = (await h.db.query<{ event: string }>("select event from audit_log where event like '%\"news.%'")).rows.map((r) => JSON.parse(r.event).type);
    for (const t of ['news.created', 'news.updated', 'news.published', 'news.unpublished', 'news.deleted']) expect(events).toContain(t);
    expect((await verifyAuditChain(h.db)).ok).toBe(true);
  });
});
