import { Component, type ReactNode } from 'react';

/**
 * Root error boundary (a class: React has no hook for it). Without it a render error unmounts the
 * whole tree and the dealer's tablet goes blank in the middle of a hand. Reloading starts the app
 * again from its stored state, so it opens on the lock screen as after any restart: the fallback
 * shows no table data and signs nothing. It promises nothing about the hand either: a request already
 * dispatched when the render failed can still commit, so the operator is told to check.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="grid min-h-screen place-items-center bg-bg p-6 text-center text-ink">
        <div className="flex max-w-sm flex-col items-center gap-5">
          <p className="text-xl font-bold">Something went wrong on this tablet.</p>
          <p className="text-muted">Reload, then check the state of the current hand before you continue: an action you had just tapped may or may not have gone through.</p>
          <button type="button" onClick={() => window.location.reload()}
            className="h-16 w-full rounded-[14px] border border-line-strong bg-surface-2 text-2xl font-bold active:border-accent">
            Reload
          </button>
        </div>
      </div>
    );
  }
}
