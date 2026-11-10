import { Button } from '@preflop/ui';
import { Component, type ReactNode } from 'react';

/**
 * Root error boundary (a class: React has no hook for it). A render error — typically a portal
 * chunk that no longer exists after a deploy, once lib/lazy.ts has already reloaded — would
 * otherwise unmount the whole tree and leave a blank page.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="grid min-h-screen place-items-center p-6 text-center">
        <div className="space-y-4">
          <p className="text-ink">A new version of PreFlop is available.</p>
          <Button type="button" onClick={() => window.location.reload()}>Reload</Button>
        </div>
      </div>
    );
  }
}
