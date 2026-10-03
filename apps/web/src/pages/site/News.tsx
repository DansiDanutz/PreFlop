import { Card, EmptyState } from '@preflop/ui';
import { Markdown, markdownText } from '@preflop/ui/markdown';
import { ArrowLeft } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { NewsCardView } from '../../components/site/blocks.tsx';
import { Eyebrow, SiteSection } from '../../components/site/SiteLayout.tsx';
import { ErrorState, Pill, Skeleton } from '../../components/ui.tsx';
import { newsDate, tagLabel, useNewsList, useNewsPost, usePageMeta } from '../../lib/site.ts';
import { NotFoundPage } from './NotFound.tsx';

const TAG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** /news — published posts, newest first, with a tag filter (?tag=). */
export function NewsPage() {
  usePageMeta('News', 'News about the PreFlop app and platform: new features, markets, tournaments, security and responsible-play updates.');
  const [params, setParams] = useSearchParams();
  const raw = params.get('tag');
  const tag = raw && TAG.test(raw) && raw.length <= 32 ? raw : null;
  // Tags come from the unfiltered list, so the filter row stays put while one is selected.
  const all = useNewsList(null, 50);
  const filtered = useNewsList(tag, 50);
  const tags = useMemo(() => [...new Set((all.data?.posts ?? []).flatMap((p) => p.tags))].sort(), [all.data]);
  const q = tag ? filtered : all;
  const setTag = (t: string | null) => setParams(t ? { tag: t } : {}, { replace: true });

  return (
    <SiteSection className="pb-10 pt-12">
      <Eyebrow>News</Eyebrow>
      <h1 className="font-serif text-5xl leading-tight sm:text-6xl">What’s new at PreFlop.</h1>
      <p className="mt-4 max-w-[680px] text-[17px] text-muted">Product updates, new markets, tournaments, and the security and responsible-play work behind the app and the platform.</p>

      {tags.length > 0 && (
        <div className="no-scrollbar -mx-4 mt-8 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Filter by topic">
          <Pill active={!tag} onClick={() => setTag(null)}>All news</Pill>
          {tags.map((t) => <Pill key={t} active={tag === t} onClick={() => setTag(t)}>{tagLabel(t)}</Pill>)}
        </div>
      )}

      <div className="mt-8" aria-live="polite">
        {q.isLoading && <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[220px]" />)}</div>}
        {q.isError && <ErrorState title="News is not reachable right now" onRetry={() => void q.refetch()} />}
        {q.data && q.data.posts.length === 0 && (
          <EmptyState title={tag ? 'No posts on this topic yet' : 'No news yet'}>{tag ? <button type="button" className="text-accent underline" onClick={() => setTag(null)}>Show all news</button> : 'Check back soon.'}</EmptyState>
        )}
        {q.data && q.data.posts.length > 0 && (
          <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {q.data.posts.map((p) => <li key={p.id}><NewsCardView post={p} headingLevel="h2" /></li>)}
          </ul>
        )}
      </div>
    </SiteSection>
  );
}

/** /news/:slug — one published post, rendered from the Markdown subset (no raw HTML). */
export function NewsArticlePage() {
  const { slug = '' } = useParams();
  const q = useNewsPost(slug);
  const post = q.data;
  usePageMeta(post ? post.title : 'News', post ? (post.summary || markdownText(post.body).slice(0, 160)) : 'News about the PreFlop app and platform.');
  const notFound = q.isError && (q.error as { status?: number }).status === 404;
  if (notFound) return <NotFoundPage />;

  return (
    <SiteSection className="max-w-[820px] pb-10 pt-10">
      <Link to="/news" className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:text-accent-strong"><ArrowLeft className="h-4 w-4" aria-hidden /> All news</Link>
      {q.isLoading && <div className="mt-8 space-y-4"><Skeleton className="h-14" /><Skeleton className="h-6 w-1/2" /><Skeleton className="h-64" /></div>}
      {q.isError && !notFound && <div className="mt-8"><ErrorState title="This post is not reachable right now" onRetry={() => void q.refetch()} /></div>}
      {post && (
        <article className="mt-6">
          <header>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <time dateTime={post.published_at}>{newsDate(post.published_at)}</time>
              {post.tags.map((t) => <Link key={t} to={`/news?tag=${encodeURIComponent(t)}`} className="rounded-full border border-line-strong px-2.5 py-0.5 text-xs hover:border-accent hover:text-accent">{tagLabel(t)}</Link>)}
            </div>
            <h1 className="mt-3 font-serif text-[40px] leading-[1.08] sm:text-5xl">{post.title}</h1>
            {post.summary && <p className="mt-4 text-lg text-muted">{post.summary}</p>}
          </header>
          <Markdown source={post.body} className="mt-8 border-t border-line pt-8" />
          <Card className="mt-12 p-5 text-sm text-muted">
            <strong className="text-ink">18+ only.</strong> PreFlop is free to play; free chips have no cash value. <Link to="/responsible-gaming" className="text-accent underline underline-offset-2">Responsible play</Link>.
          </Card>
        </article>
      )}
    </SiteSection>
  );
}
