import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { ApiError } from '@preflop/client';
import { Button, Card, Flop, Spinner, Wordmark } from '@preflop/ui';
import { useAuth } from '../lib/auth.tsx';
import { isEmail } from '../lib/rules.ts';
import { errorMessage } from '../lib/format.ts';
import { WEB_URL } from '../lib/api.ts';
import { Field, TextInput } from '../components/ui.tsx';
import { EnvBadge } from '../components/Shell.tsx';

export function LoginPage() {
  const { token, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  // Arriving from an owner link (/claim/:token): the recipient may not have an account yet.
  const claiming = ((loc.state as { from?: string } | null)?.from ?? '').startsWith('/claim/');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Two-factor: shown once the API answers mfa_required.
  const [otp, setOtp] = useState('');
  const [needOtp, setNeedOtp] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (token) return <Navigate to="/" replace />;

  const emailErr = !email.trim() ? 'Enter your email.' : !isEmail(email) ? 'That does not look like an email address.' : null;
  const pwErr = !password ? 'Enter your password.' : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setErr(null);
    if (emailErr || pwErr) return;
    if (needOtp && !/^\d{6}$/.test(otp)) { setErr('Enter the 6-digit code from your authenticator app.'); return; }
    setBusy(true);
    try {
      await login(email.trim(), password, needOtp ? otp : undefined);
      const from = (loc.state as { from?: string } | null)?.from;
      nav(from && from !== '/login' ? from : '/', { replace: true });
    } catch (x) {
      if (x instanceof ApiError && x.type === 'mfa_required') { setNeedOtp(true); return; }
      if (x instanceof ApiError && x.type === 'invalid_otp') { setErr('That code is not valid. Wait for the next code and try again.'); setOtp(''); return; }
      setErr(x instanceof ApiError && (x.status === 401 || x.status === 400) ? 'Wrong email or password.' : errorMessage(x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="felt relative hidden flex-col justify-between overflow-hidden p-12 lg:flex">
        <div className="flex items-baseline gap-3"><Wordmark size="lg" /><span className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">Console</span></div>
        <div>
          <Flop cards={['Kh', '7d', '2c']} size="lg" className="justify-start" />
          <h2 className="mt-10 max-w-md font-serif text-4xl leading-tight">Run the tables, the rooms and the books behind every flop.</h2>
          <p className="mt-3 max-w-md text-ink/70">One console for the PreFlop team, poker clubs, betting partners and organizers.</p>
        </div>
        <span className="text-xs text-ink/50">Physical-table play stays disabled until the PreFlop Trusted Shuffler is certified.</span>
      </div>
      <div className="flex flex-col items-center justify-center px-4 py-12">
        <div className="mb-8 flex items-baseline gap-3 lg:hidden"><Wordmark size="lg" /><span className="text-xs font-semibold uppercase tracking-[0.2em] text-faint">Console</span></div>
        <Card className="w-full max-w-sm p-7">
          <div className="mb-1 flex items-center justify-between gap-2"><h1 className="font-serif text-3xl">Sign in</h1><EnvBadge /></div>
          <p className="mb-6 text-sm text-muted">Use your PreFlop account.</p>
          <form onSubmit={submit} noValidate className="space-y-4">
            <Field label="Email" error={touched ? emailErr : null}>
              {(p) => <TextInput {...p} type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@club.com" />}
            </Field>
            <Field label="Password" error={touched ? pwErr : null}>
              {(p) => <TextInput {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
            {needOtp && (
              <Field label="Authentication code" hint="The 6-digit code from your authenticator app.">
                {(p) => <TextInput {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />}
              </Field>
            )}
            {err && <p role="alert" className="rounded-[10px] border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-ink">{err}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy && <Spinner className="h-4 w-4" />}Sign in</Button>
          </form>
          {claiming && (
            <p className="mt-5 rounded-[10px] border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-ink/90">
              You were sent an owner link. No PreFlop account yet?{' '}
              <a className="font-semibold text-accent underline" href={`${WEB_URL}/register`} target="_blank" rel="noreferrer">Create one</a>, then sign in here: the link waits for you.
            </p>
          )}
        </Card>
        <p className="mt-6 max-w-sm text-center text-xs text-faint">Clubs, partners and organizers get access once PreFlop approves their application.</p>
      </div>
    </div>
  );
}
