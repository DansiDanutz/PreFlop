import { ApiError } from '@preflop/client';
import { Button, Flop, Wordmark } from '@preflop/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { Field, Notice, Select } from '../components/ui.tsx';
import { countryOptions, dobProblem } from '../lib/account.ts';
import { api, setToken } from '../lib/api.ts';
import { safeNext, useToken } from '../lib/auth.tsx';
import { qk } from '../lib/queries.ts';
import { errorText } from '../lib/problems.ts';

/** Today as YYYY-MM-DD (the latest date a date input should offer). */
const today = () => new Date().toISOString().slice(0, 10);

function AuthFrame({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-[440px] flex-col px-5 pb-10">
      <header className="flex h-16 items-center justify-between">
        <Link to="/" aria-label="PreFlop home"><Wordmark /></Link>
        <Link to="/" className="text-sm text-muted hover:text-ink">Back to site</Link>
      </header>
      <div className="felt felt-vignette relative mt-2 h-[132px] overflow-hidden rounded-[18px]" aria-hidden>
        <span className="pf-watermark absolute bottom-1 left-1/2 -translate-x-1/2 text-[34px]">PreFlop</span>
        <Flop cards={['Ah', 'Kh', 'Qh']} size="sm" className="absolute inset-0" />
      </div>
      <h1 className="mt-6 font-serif text-[34px] leading-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted">{subtitle}</p>
      <div className="mt-6">{children}</div>
      <div className="mt-6 text-center text-sm text-muted">{footer}</div>
      <p className="mt-auto pt-8 text-center text-xs text-faint">18+ only. Free chips have no cash value. <Link to="/responsible-gaming" className="underline">Play responsibly</Link>.</p>
    </div>
  );
}

export function LoginPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const token = useToken();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Accounts with two-factor authentication: the API asks for the code after the password.
  const [otp, setOtp] = useState('');
  const [needOtp, setNeedOtp] = useState(false);
  const login = useMutation({
    mutationFn: () => api.login({ email: email.trim(), password, ...(needOtp && otp ? { otp: otp.trim() } : {}) }),
    onSuccess: ({ token: t }) => {
      qc.clear();
      setToken(t);
      nav(next, { replace: true });
    },
    onError: (e) => { if (e instanceof ApiError && e.type === 'mfa_required') setNeedOtp(true); },
  });
  if (token && !login.isPending) return <Navigate to={next} replace />;
  const submit = (e: FormEvent) => { e.preventDefault(); login.mutate(); };
  const askingForCode = login.error instanceof ApiError && login.error.type === 'mfa_required';
  return (
    <AuthFrame title="Welcome back" subtitle="Sign in to predict the next flop."
      footer={<>New to PreFlop? <Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-accent">Play free</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {needOtp && (
          <Field label="Authentication code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} hint="The 6-digit code from your authenticator app." />
        )}
        {login.isError && !askingForCode && <Notice tone="danger">{errorText(login.error)}</Notice>}
        <Button type="submit" size="lg" className="w-full" disabled={login.isPending || !email || !password || (needOtp && otp.length !== 6)}>{login.isPending ? 'Signing in…' : 'Sign in'}</Button>
        <p className="text-center text-sm"><Link to="/forgot-password" className="text-muted underline hover:text-ink">Forgot your password?</Link></p>
      </form>
    </AuthFrame>
  );
}

export function RegisterPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const token = useToken();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState('');
  const [dob, setDob] = useState('');
  const [touched, setTouched] = useState(false);
  const [adult, setAdult] = useState(false);
  const countries = useMemo(() => countryOptions(), []);
  // An agent's invitation link: /register?ref=CODE
  const ref = /^[A-Za-z0-9]{4,20}$/.test(params.get('ref') ?? '') ? params.get('ref')!.toUpperCase() : null;
  const reg = useMutation({
    mutationFn: () => api.register({ display_name: name.trim(), email: email.trim(), password, date_of_birth: dob, country, ...(ref ? { ref } : {}) }),
    onSuccess: ({ token: t }) => {
      qc.clear();
      setToken(t);
      nav(next, { replace: true });
    },
  });
  if (token && !reg.isPending) return <Navigate to={next} replace />;
  const pwShort = password.length > 0 && password.length < 8;
  const dobErr = dobProblem(dob);
  const submit = (e: FormEvent) => { e.preventDefault(); setTouched(true); if (!pwShort && adult && !dobErr && country) reg.mutate(); };
  return (
    <AuthFrame title="Play free" subtitle="Create an account and get 10,000 free chips to practice with."
      footer={<>Already have an account? <Link to={`/login${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-accent">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {ref && <p className="rounded-[8px] border border-accent/40 bg-accent-deep/40 px-3 py-2 text-[13px] text-ink/85">Invited with code <span className="font-mono text-accent">{ref}</span>.</p>}
        <Field label="Display name" autoComplete="nickname" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
          hint="At least 8 characters." error={pwShort ? 'Use at least 8 characters.' : null} />
        <Field label="Date of birth" type="date" autoComplete="bday" required max={today()} value={dob} onChange={(e) => setDob(e.target.value)}
          onBlur={() => setTouched(true)} error={(touched || dob) && dobErr ? dobErr : null} hint="You must be 18 or over to play." />
        <Select label="Country of residence" required value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="" disabled>Choose your country</option>
          {countries.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </Select>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[var(--color-accent)]" />
          <span>I am 18 or older and accept the <Link to="/terms" className="text-accent underline">terms</Link> and <Link to="/privacy" className="text-accent underline">privacy notice</Link>.</span>
        </label>
        {reg.isError && <Notice tone="danger">{errorText(reg.error)}</Notice>}
        <Button type="submit" size="lg" className="w-full" disabled={reg.isPending || !name.trim() || !email || password.length < 8 || !adult || !!dobErr || !country}>
          {reg.isPending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthFrame>
  );
}

/** /forgot-password: always the same answer, whether or not the address has an account. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const send = useMutation({ mutationFn: () => api.forgotPassword(email.trim()) });
  return (
    <AuthFrame title="Forgot your password?" subtitle="We will email you a link to choose a new one."
      footer={<>Remembered it? <Link to="/login" className="font-semibold text-accent">Sign in</Link></>}>
      {send.isSuccess ? (
        <Notice tone="accent">If an account uses <strong>{email.trim()}</strong>, a reset link is on its way. It works for 1 hour.</Notice>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (email.trim()) send.mutate(); }} className="space-y-4" noValidate>
          <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          {send.isError && <Notice tone="danger">{errorText(send.error)}</Notice>}
          <Button type="submit" size="lg" className="w-full" disabled={send.isPending || !email.trim()}>{send.isPending ? 'Sending…' : 'Send reset link'}</Button>
        </form>
      )}
    </AuthFrame>
  );
}

/** /reset-password?token=…: a new password from the emailed link; every session is signed out. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const qc = useQueryClient();
  const reset = useMutation({
    mutationFn: () => api.resetPassword(token, password),
    onSuccess: () => { setToken(null); qc.clear(); },
  });
  const mismatch = again.length > 0 && again !== password;
  return (
    <AuthFrame title="Choose a new password" subtitle="This signs you out on every device."
      footer={<Link to="/login" className="font-semibold text-accent">Back to sign in</Link>}>
      {!token ? <Notice tone="warn">This link is incomplete. Open the link from the email again, or <Link to="/forgot-password" className="underline">ask for a new one</Link>.</Notice>
        : reset.isSuccess ? <Notice tone="accent">Your password is changed. <Link to="/login" className="font-semibold underline">Sign in</Link> with the new one.</Notice> : (
          <form onSubmit={(e) => { e.preventDefault(); if (password.length >= 8 && !mismatch) reset.mutate(); }} className="space-y-4" noValidate>
            <Field label="New password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 8 characters." />
            <Field label="Repeat the new password" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} error={mismatch ? 'The passwords do not match.' : null} />
            {reset.isError && (
              <Notice tone="danger">
                {errorText(reset.error)}{' '}
                {reset.error instanceof ApiError && reset.error.type === 'invalid_token' && <Link to="/forgot-password" className="underline">Send a new link</Link>}
              </Notice>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={reset.isPending || password.length < 8 || again !== password}>{reset.isPending ? 'Saving…' : 'Set new password'}</Button>
          </form>
        )}
    </AuthFrame>
  );
}

/** /verify-email?token=…: confirms the address once (the link is single-use). */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const signedIn = !!useToken();
  const qc = useQueryClient();
  const verify = useMutation({
    mutationFn: () => api.verifyEmail(token),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.me }),
  });
  // Exactly one attempt per page load (React's strict mode mounts twice in development).
  const started = useRef(false);
  useEffect(() => {
    if (token && !started.current) { started.current = true; verify.mutate(); }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <AuthFrame title="Confirm your email" subtitle="One click keeps your account secure."
      footer={<Link to={signedIn ? '/app' : '/login'} className="font-semibold text-accent">{signedIn ? 'Go to the lobby' : 'Sign in'}</Link>}>
      {!token ? <Notice tone="warn">This link is incomplete. Open the link from the email again.</Notice>
        : verify.isSuccess ? <Notice tone="accent">Thanks, your email address is confirmed.</Notice>
          : verify.isError ? <Notice tone="danger">{errorText(verify.error)}{signedIn ? ' You can send a new link from the banner in the app.' : ''}</Notice>
            : <Notice tone="info">Confirming…</Notice>}
    </AuthFrame>
  );
}
