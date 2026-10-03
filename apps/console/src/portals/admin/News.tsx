import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AdminNewsPost, NewsInput } from '@preflop/client';
import { Badge, Button } from '@preflop/ui';
import { Markdown } from '@preflop/ui/markdown';
import { ExternalLink, Newspaper, Plus } from 'lucide-react';
import { api, WEB_URL } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { DataTable } from '../../components/DataTable.tsx';
import { Callout, ConfirmDialog, Field, Kpi, Modal, PageHeader, QueryView, Section, TextArea, TextInput, useAction } from '../../components/ui.tsx';

/** News posts for the public website (/news). Admin and ops write; every change is audited. */

const TAG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

/** "Tournaments, Free chips" → ['tournaments', 'free-chips'] */
export function parseTags(s: string): string[] {
  return [...new Set(s.split(',').map((t) => t.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).filter(Boolean))];
}

/** Problems with an editor form, before it is sent (the API checks the same rules). */
export function newsFormProblems(f: { title: string; summary: string; body: string; tags: string; slug: string }): Record<string, string> {
  const p: Record<string, string> = {};
  const t = f.title.trim();
  if (t.length < 3 || t.length > 120) p.title = 'A title is 3 to 120 characters.';
  if (f.summary.trim().length > 300) p.summary = 'A summary is at most 300 characters.';
  if (f.body.length > 20_000) p.body = 'The body is at most 20,000 characters.';
  const tags = parseTags(f.tags);
  if (tags.length > 8) p.tags = 'At most 8 tags.';
  else if (tags.some((x) => x.length > 32 || !TAG.test(x))) p.tags = 'Tags are short lowercase words.';
  if (f.slug.trim() && (!SLUG.test(f.slug.trim()) || f.slug.trim().length > 80)) p.slug = 'Lowercase letters, digits and hyphens, at most 80 characters.';
  return p;
}

const EMPTY = { title: '', summary: '', body: '', tags: '', slug: '' };

function Editor({ post, open, onClose }: { post: AdminNewsPost | null; open: boolean; onClose: () => void }) {
  const [f, setF] = useState(EMPTY);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  useEffect(() => {
    if (!open) return;
    setTab('write');
    setF(post ? { title: post.title, summary: post.summary, body: post.body, tags: post.tags.join(', '), slug: post.slug } : EMPTY);
  }, [open, post]);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const problems = newsFormProblems(f);
  const valid = Object.keys(problems).length === 0;
  const body = (): NewsInput => ({
    title: f.title.trim(), summary: f.summary.trim(), body: f.body, tags: parseTags(f.tags),
    ...(f.slug.trim() ? { slug: f.slug.trim() } : {}),
  });
  const save = useAction(async (publish: boolean) => {
    const saved = post ? await api.adminUpdateNews(post.id, body()) : await api.adminCreateNews(body());
    return publish && saved.status !== 'published' ? api.adminPublishNews(saved.id) : saved;
  }, {
    invalidate: [['admin', 'news']],
    success: (r) => (r.status === 'published' ? `“${r.title}” is published.` : `“${r.title}” saved as a draft.`),
    onSuccess: onClose,
  });
  const preview = (
    <div className="min-h-64 rounded-[10px] border border-line bg-bg p-4">
      {f.title.trim() ? <h2 className="font-serif text-2xl leading-snug">{f.title.trim()}</h2> : <p className="text-sm text-faint">The title appears here.</p>}
      {f.summary.trim() && <p className="mt-2 text-[15px] text-muted">{f.summary.trim()}</p>}
      <Markdown source={f.body} className="mt-4 text-[14px]" />
    </div>
  );
  return (
    <Modal open={open} onClose={onClose} wide title={post ? `Edit “${post.title}”` : 'New post'}
      footer={<>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant={post?.status === 'published' ? 'primary' : 'secondary'} disabled={!valid || save.isPending} onClick={() => save.mutate(false)}>{post?.status === 'published' ? 'Save changes' : 'Save draft'}</Button>
        {post?.status !== 'published' && <Button size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate(true)}>Save and publish</Button>}
      </>}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Title" error={f.title && problems.title ? problems.title : null} className="md:col-span-2">{(p) => <TextInput {...p} value={f.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} placeholder="Tournaments are live (free chips)" />}</Field>
        <Field label="Summary" hint="One or two sentences for the news cards and search results." error={problems.summary ?? null} className="md:col-span-2">{(p) => <TextInput {...p} value={f.summary} maxLength={300} onChange={(e) => set({ summary: e.target.value })} />}</Field>
        <Field label="Tags" hint="Comma-separated, e.g. tournaments, players." error={problems.tags ?? null}>{(p) => <TextInput {...p} value={f.tags} onChange={(e) => set({ tags: e.target.value })} />}</Field>
        <Field label="Slug (optional)" hint="Blank: made from the title. Changing it changes the public link." error={problems.slug ?? null}>{(p) => <TextInput {...p} value={f.slug} onChange={(e) => set({ slug: e.target.value })} placeholder="made-from-the-title" />}</Field>
      </div>
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between gap-3 md:hidden" role="group" aria-label="Editor view">
          <div className="flex gap-1">
            {(['write', 'preview'] as const).map((t) => (
              <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}
                className={`rounded-[8px] border px-3 py-1.5 text-sm ${tab === t ? 'border-line-strong bg-surface-3 text-ink' : 'border-transparent text-muted'}`}>{t === 'write' ? 'Write' : 'Preview'}</button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className={tab === 'write' ? '' : 'hidden md:block'}>
            <Field label="Body" error={problems.body ?? null} hint={<>Supports <code>## heading</code>, <code>### subheading</code>, <code>**bold**</code>, <code>*italic*</code>, <code>`code`</code>, <code>- list</code>, <code>1. list</code> and <code>[text](https://…)</code>. No HTML.</>}>
              {(p) => <TextArea {...p} value={f.body} rows={18} onChange={(e) => set({ body: e.target.value })} className="min-h-[360px]" />}
            </Field>
          </div>
          <div className={tab === 'preview' ? '' : 'hidden md:block'}>
            <div className="mb-1.5 text-[13px] font-medium text-muted">Live preview</div>
            {preview}
          </div>
        </div>
      </div>
      <div className="mt-4"><Callout tone="info" title="House rules">Facts only. Never say or imply real money is available; chips and diamonds have no cash value; no guaranteed winnings, no pressure wording.</Callout></div>
    </Modal>
  );
}

export function News() {
  const { me } = useAuth();
  const write = me?.platform_role === 'admin' || me?.platform_role === 'ops';
  const [editing, setEditing] = useState<AdminNewsPost | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AdminNewsPost | null>(null);
  const q = useQuery({ queryKey: ['admin', 'news'], queryFn: () => api.adminNews() });
  const publish = useAction((p: AdminNewsPost) => (p.status === 'published' ? api.adminUnpublishNews(p.id) : api.adminPublishNews(p.id)),
    { invalidate: [['admin', 'news']], success: (r) => (r.status === 'published' ? `“${r.title}” is published.` : `“${r.title}” is back to draft.`) });
  const remove = useAction((p: AdminNewsPost) => api.adminDeleteNews(p.id),
    { invalidate: [['admin', 'news']], success: 'Post deleted.', onSuccess: () => setDeleting(null) });
  return (
    <>
      <PageHeader eyebrow="Platform" title="News"
        subtitle="Posts about the app and the platform for the public website. Drafts are only visible here; every change is audited."
        actions={write && <Button size="sm" onClick={() => setCreating(true)}><Plus size={15} aria-hidden />New post</Button>} />
      <QueryView q={q} what="news">
        {(d) => (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Published" value={d.posts.filter((p) => p.status === 'published').length} tone="accent" />
              <Kpi label="Drafts" value={d.posts.filter((p) => p.status === 'draft').length} />
            </div>
            <Section title="All posts">
              <DataTable rows={d.posts} rowKey={(p) => p.id} caption="News posts"
                empty={<div className="py-8 text-center text-sm text-muted"><Newspaper className="mx-auto mb-2 text-accent/70" aria-hidden />No posts yet.</div>}
                columns={[
                  { key: 'title', header: 'Post', sort: (p) => p.title, cell: (p) => <div className="min-w-[220px]"><div className="font-semibold">{p.title}</div><div className="font-mono text-xs text-muted">/news/{p.slug}</div></div> },
                  { key: 'tags', header: 'Tags', cell: (p) => <div className="flex flex-wrap gap-1">{p.tags.map((t) => <Badge key={t} tone="muted">{t}</Badge>)}</div> },
                  { key: 'status', header: 'Status', sort: (p) => p.status, cell: (p) => <Badge tone={p.status === 'published' ? 'accent' : 'info'}>{p.status}</Badge> },
                  { key: 'published', header: 'Published', sort: (p) => p.published_at, cell: (p) => <span className="whitespace-nowrap text-sm">{p.status === 'published' ? when(p.published_at) : '—'}</span> },
                  { key: 'updated', header: 'Updated', sort: (p) => p.updated_at, cell: (p) => <span className="whitespace-nowrap text-sm text-muted">{when(p.updated_at)}</span> },
                  { key: 'act', header: '', align: 'right', cell: (p) => (
                    <div className="flex justify-end gap-2">
                      {p.status === 'published' && (
                        <a href={`${WEB_URL}/news/${p.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1 px-2 text-sm text-muted hover:text-ink" aria-label={`View “${p.title}” on the website`}><ExternalLink size={14} aria-hidden />View</a>
                      )}
                      {write && <>
                        <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>Edit</Button>
                        <Button size="sm" variant={p.status === 'published' ? 'ghost' : 'primary'} disabled={publish.isPending} onClick={() => publish.mutate(p)}>{p.status === 'published' ? 'Unpublish' : 'Publish'}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleting(p)}>Delete</Button>
                      </>}
                    </div>
                  ) },
                ]} />
            </Section>
          </div>
        )}
      </QueryView>
      <Editor open={creating || !!editing} post={editing} onClose={() => { setCreating(false); setEditing(null); }} />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} title={`Delete “${deleting?.title ?? ''}”?`} confirmLabel="Delete post" busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}>
        The post is removed for good{deleting?.status === 'published' ? ' and its public link stops working' : ''}. To hide it but keep it, unpublish it instead.
      </ConfirmDialog>
    </>
  );
}
