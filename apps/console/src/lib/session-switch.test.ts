import { forgetPreviousSession } from '@preflop/client';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

/**
 * Another tab replaces the session while this one is open: the new account's `me` query is already
 * mounted and fetching when the old cache is dropped. It must still complete (qc.clear() here
 * removed it silently and left the console on "Signing you in…").
 */
describe('a sign-in in another tab', () => {
  it('drops the previous account\'s data and still completes the new session\'s query', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['me', 'old-token'], { email: 'old@test.dev' });
    qc.setQueryData(['users'], [{ id: 'u_old' }]);
    const observer = new QueryObserver(qc, { queryKey: ['me', 'new-token'], queryFn: async () => ({ email: 'new@test.dev' }) });
    const unsubscribe = observer.subscribe(() => {});

    forgetPreviousSession(qc, 'old-token', 'new-token');
    await new Promise((r) => setTimeout(r, 20));

    expect(observer.getCurrentResult()).toMatchObject({ status: 'success', data: { email: 'new@test.dev' } });
    expect(qc.getQueryData(['me', 'old-token'])).toBeUndefined();
    expect(qc.getQueryData(['users'])).toBeUndefined();
    unsubscribe();
  });
});
