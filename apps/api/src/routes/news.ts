import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { audit } from '../lib/audit.ts';
import { type Tx, tx } from '../lib/db.ts';
import { conflict, notFound } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { requirePlatform } from './admin.ts';

/**
 * News about the app and the platform (migration 015). The public website reads published posts;
 * the PreFlop team (admin, ops) writes them in the console. Every change is audited.
 */

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROLES = ['admin', 'ops'] as const;

const Tags = z.array(z.string().trim().toLowerCase().max(32).regex(TAG, 'tags are lowercase words joined by hyphens'))
  .max(8).refine((a) => new Set(a).size === a.length, 'duplicate tag');

const PostBody = z.object({
  title: z.string().trim().min(3).max(120),
  summary: z.string().trim().max(300).default(''),
  body: z.string().max(20_000).default(''),
  tags: Tags.default([]),
  slug: z.string().trim().max(80).regex(SLUG, 'a slug is lowercase words joined by hyphens').optional(),
}).strict();

const PostPatch = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  summary: z.string().trim().max(300).optional(),
  body: z.string().max(20_000).optional(),
  tags: Tags.optional(),
  slug: z.string().trim().max(80).regex(SLUG, 'a slug is lowercase words joined by hyphens').optional(),
}).strict();

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(12),
  tag: z.string().max(32).regex(TAG).optional(),
});

const IdParam = z.object({ id: z.string().min(1).max(64) });

export interface NewsRow {
  id: string; slug: string; title: string; summary: string; body: string; tags: string[];
  status: 'draft' | 'published'; published_at: Date | null; author_id: string | null; created_at: Date; updated_at: Date;
}

/** A URL slug from a title: lowercase ASCII words joined by hyphens, at most 80 characters. */
export function slugify(title: string): string {
  const s = title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const cut = s.slice(0, 80).replace(/-+$/, '');
  return cut || 'post';
}

/** The first free slug: base, base-2, base-3… (checked inside the writing transaction). */
async function freeSlug(c: Tx, base: string, exceptId: string | null): Promise<string> {
  const taken = new Set((await c.query<{ slug: string }>(
    `select slug from news_posts where (slug = $1 or slug like $1 || '-%') and id is distinct from $2`, [base, exceptId])).rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const s = base.slice(0, 80 - suffix.length).replace(/-+$/, '') + suffix;
    if (!taken.has(s)) return s;
  }
}

async function slugTaken(c: Tx, slug: string, exceptId: string | null): Promise<boolean> {
  return !!(await c.query('select 1 from news_posts where slug = $1 and id is distinct from $2', [slug, exceptId])).rowCount;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Public card: no body, no author. */
const card = (r: NewsRow) => ({ id: r.id, slug: r.slug, title: r.title, summary: r.summary, tags: r.tags, published_at: iso(r.published_at)! });
const article = (r: NewsRow) => ({ ...card(r), body: r.body, updated_at: iso(r.updated_at)! });
const adminView = (r: NewsRow) => ({
  id: r.id, slug: r.slug, title: r.title, summary: r.summary, body: r.body, tags: r.tags, status: r.status,
  published_at: iso(r.published_at), author_id: r.author_id, created_at: iso(r.created_at)!, updated_at: iso(r.updated_at)!,
});

/** Maps a unique-violation on the slug (two writers racing) to 409. */
async function guardSlug<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if ((e as { code?: string; constraint?: string }).code === '23505') throw conflict('slug_taken', 'another post already uses this slug');
    throw e;
  }
}

export async function newsRoutes(app: FastifyInstance, ctx: AppContext) {
  // ---------------------------------------------------------------- public

  app.get('/v1/news', async (req) => {
    const q = ListQuery.parse(req.query);
    const rows = (await ctx.db.query<NewsRow>(
      `select * from news_posts where status = 'published' and published_at <= now() and ($2::text is null or $2 = any(tags))
       order by published_at desc, id desc limit $1`, [q.limit, q.tag ?? null])).rows;
    return { posts: rows.map(card) };
  });

  app.get('/v1/news/:slug', async (req) => {
    const { slug } = req.params as { slug: string };
    if (typeof slug !== 'string' || slug.length > 80 || !SLUG.test(slug)) throw notFound('post');
    const r = (await ctx.db.query<NewsRow>(`select * from news_posts where slug = $1 and status = 'published' and published_at <= now()`, [slug])).rows[0];
    if (!r) throw notFound('post');
    return article(r);
  });

  // ---------------------------------------------------------------- PreFlop team

  app.get('/v1/admin/news', async (req) => {
    await requirePlatform(ctx, req, ...ROLES);
    const rows = (await ctx.db.query<NewsRow>('select * from news_posts order by coalesce(published_at, updated_at) desc, id desc')).rows;
    return { posts: rows.map(adminView) };
  });

  app.post('/v1/admin/news', async (req, reply) => {
    const u = await requirePlatform(ctx, req, ...ROLES);
    const b = PostBody.parse(req.body ?? {});
    const row = await guardSlug(() => tx(ctx.db, async (c) => {
      if (b.slug && (await slugTaken(c, b.slug, null))) throw conflict('slug_taken', 'another post already uses this slug');
      const slug = b.slug ?? (await freeSlug(c, slugify(b.title), null));
      const id = newId('news');
      const r = (await c.query<NewsRow>(
        `insert into news_posts (id, slug, title, summary, body, tags, author_id) values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [id, slug, b.title, b.summary, b.body, b.tags, u.id])).rows[0]!;
      await audit(c, { type: 'news.created', newsId: id, slug, by: u.id });
      return r;
    }));
    return reply.code(201).send(adminView(row));
  });

  app.put('/v1/admin/news/:id', async (req) => {
    const u = await requirePlatform(ctx, req, ...ROLES);
    const { id } = IdParam.parse(req.params);
    const p = PostPatch.parse(req.body ?? {});
    const row = await guardSlug(() => tx(ctx.db, async (c) => {
      const cur = (await c.query<NewsRow>('select * from news_posts where id = $1 for update', [id])).rows[0];
      if (!cur) throw notFound('post');
      if (p.slug && p.slug !== cur.slug && (await slugTaken(c, p.slug, id))) throw conflict('slug_taken', 'another post already uses this slug');
      const r = (await c.query<NewsRow>(
        `update news_posts set title = $2, summary = $3, body = $4, tags = $5, slug = $6, updated_at = now() where id = $1 returning *`,
        [id, p.title ?? cur.title, p.summary ?? cur.summary, p.body ?? cur.body, p.tags ?? cur.tags, p.slug ?? cur.slug])).rows[0]!;
      await audit(c, { type: 'news.updated', newsId: id, slug: r.slug, by: u.id, fields: Object.keys(p).sort() });
      return r;
    }));
    return adminView(row);
  });

  for (const action of ['publish', 'unpublish'] as const) {
    app.post(`/v1/admin/news/:id/${action}`, async (req) => {
      const u = await requirePlatform(ctx, req, ...ROLES);
      const { id } = IdParam.parse(req.params);
      const row = await tx(ctx.db, async (c) => {
        const r = (await c.query<NewsRow>(
          action === 'publish'
            // A first publication is dated now; publishing again after an unpublish keeps the original date.
            ? `update news_posts set status = 'published', published_at = coalesce(published_at, now()), updated_at = now() where id = $1 returning *`
            : `update news_posts set status = 'draft', updated_at = now() where id = $1 returning *`, [id])).rows[0];
        if (!r) throw notFound('post');
        await audit(c, { type: `news.${action}ed`, newsId: id, slug: r.slug, by: u.id });
        return r;
      });
      return adminView(row);
    });
  }

  app.delete('/v1/admin/news/:id', async (req) => {
    const u = await requirePlatform(ctx, req, ...ROLES);
    const { id } = IdParam.parse(req.params);
    await tx(ctx.db, async (c) => {
      const r = (await c.query<{ slug: string; title: string }>('delete from news_posts where id = $1 returning slug, title', [id])).rows[0];
      if (!r) throw notFound('post');
      await audit(c, { type: 'news.deleted', newsId: id, slug: r.slug, title: r.title, by: u.id });
    });
    return { ok: true as const };
  });
}
