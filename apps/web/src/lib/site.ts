import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from './api.ts';

/** Public website helpers: per-page title and description, news queries, contact address. */

export const SITE_NAME = 'PreFlop';

/** The <title> of a page: "Page · PreFlop", or the site's own for the home page. */
export const pageTitle = (title: string | null) => (title ? `${title} · ${SITE_NAME}` : `${SITE_NAME}: predict the flop`);

function setMeta(name: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/** Sets document.title and the meta description for the current page (no inline script, CSP-safe). */
export function usePageMeta(title: string | null, description: string) {
  useEffect(() => {
    document.title = pageTitle(title);
    setMeta('description', description);
  }, [title, description]);
}

/** Contact address for the website, from VITE_CONTACT_EMAIL at build time; null when not configured. */
export function contactEmail(): string | null {
  const v = (import.meta.env.VITE_CONTACT_EMAIL as string | undefined)?.trim();
  return v && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v) ? v : null;
}

export const newsKeys = {
  list: (tag: string | null, limit: number) => ['news', 'list', tag, limit] as const,
  post: (slug: string) => ['news', 'post', slug] as const,
};

export const useNewsList = (tag: string | null = null, limit = 12) =>
  useQuery({ queryKey: newsKeys.list(tag, limit), queryFn: () => api.newsList({ limit, ...(tag ? { tag } : {}) }), staleTime: 5 * 60_000 });

export const useNewsPost = (slug: string) =>
  useQuery({ queryKey: newsKeys.post(slug), queryFn: () => api.newsPost(slug), staleTime: 5 * 60_000, retry: (n, e) => (e as { status?: number }).status !== 404 && n < 2 });

/** "3 October 2026" */
export const newsDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "partner-widget" → "Partner widget" */
export const tagLabel = (t: string) => {
  const s = t.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
