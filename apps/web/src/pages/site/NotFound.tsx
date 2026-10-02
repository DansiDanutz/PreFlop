import { CardBack } from '@preflop/ui';
import { Link } from 'react-router';

export function NotFoundPage({ inApp = false }: { inApp?: boolean }) {
  return (
    <div className="mx-auto flex max-w-[560px] flex-col items-center px-5 py-20 text-center">
      <div className="felt felt-vignette flex h-40 w-full max-w-[360px] items-center justify-center gap-3 rounded-[18px]" aria-hidden>
        <CardBack size="sm" />
        <CardBack size="sm" />
        <CardBack size="sm" />
      </div>
      <p className="mt-8 text-sm font-semibold uppercase tracking-[0.18em] text-accent">404</p>
      <h1 className="mt-2 font-serif text-5xl">Misdeal.</h1>
      <p className="mt-3 text-muted">This page is not in the deck. It may have moved, or the link is wrong.</p>
      <Link to={inApp ? '/app' : '/'} className="mt-8 inline-flex h-12 items-center rounded-[14px] bg-accent px-6 font-semibold text-accent-ink hover:bg-accent-strong">
        {inApp ? 'Back to the lobby' : 'Back to home'}
      </Link>
    </div>
  );
}
