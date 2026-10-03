import { type ComponentType, type LazyExoticComponent, lazy } from 'react';

/**
 * React.lazy for a named export: the route groups (admin, org, club, partner, organizer, growth,
 * agent) load as separate same-origin chunks the first time one of their pages opens.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyNamed<M, K extends keyof M>(load: () => Promise<M>, name: K): LazyExoticComponent<M[K] & ComponentType<any>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return lazy(() => load().then((m) => ({ default: m[name] as M[K] & ComponentType<any> })));
}
