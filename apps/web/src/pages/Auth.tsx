import { Button, Flop, Wordmark } from '@preflop/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { Field, Notice, Select } from '../components/ui.tsx';
import { api, setToken } from '../lib/api.ts';
import { safeNext, useToken } from '../lib/auth.tsx';
import { errorText } from '../lib/problems.ts';

const COUNTRIES: [string, string][] = [
  ['', 'Prefer not to say'], ['RO', 'Romania'], ['GB', 'United Kingdom'], ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'],
  ['NL', 'Netherlands'], ['PT', 'Portugal'], ['IE', 'Ireland'], ['MT', 'Malta'], ['CY', 'Cyprus'], ['BG', 'Bulgaria'], ['GR', 'Greece'], ['US', 'United States'], ['CA', 'Canada'],
];

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
  const login = useMutation({
    mutationFn: () => api.login({ email: email.trim(), password }),
    onSuccess: ({ token: t }) => {
      qc.clear();
      setToken(t);
      nav(next, { replace: true });
    },
  });
  if (token && !login.isPending) return <Navigate to={next} replace />;
  const submit = (e: FormEvent) => { e.preventDefault(); login.mutate(); };
  return (
    <AuthFrame title="Welcome back" subtitle="Sign in to predict the next flop."
      footer={<>New to PreFlop? <Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-accent">Play free</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {login.isError && <Notice tone="danger">{errorText(login.error)}</Notice>}
        <Button type="submit" size="lg" className="w-full" disabled={login.isPending || !email || !password}>{login.isPending ? 'Signing in…' : 'Sign in'}</Button>
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
  const [adult, setAdult] = useState(false);
  // An agent's invitation link: /register?ref=CODE
  const ref = /^[A-Za-z0-9]{4,20}$/.test(params.get('ref') ?? '') ? params.get('ref')!.toUpperCase() : null;
  const reg = useMutation({
    mutationFn: () => api.register({ display_name: name.trim(), email: email.trim(), password, ...(country ? { country } : {}), ...(ref ? { ref } : {}) }),
    onSuccess: ({ token: t }) => {
      qc.clear();
      setToken(t);
      nav(next, { replace: true });
    },
  });
  if (token && !reg.isPending) return <Navigate to={next} replace />;
  const pwShort = password.length > 0 && password.length < 8;
  const submit = (e: FormEvent) => { e.preventDefault(); if (!pwShort && adult) reg.mutate(); };
  return (
    <AuthFrame title="Play free" subtitle="Create an account and get 10,000 free chips to practice with."
      footer={<>Already have an account? <Link to={`/login${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-accent">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {ref && <p className="rounded-[8px] border border-accent/40 bg-accent-deep/40 px-3 py-2 text-[13px] text-ink/85">Invited with code <span className="font-mono text-accent">{ref}</span>.</p>}
        <Field label="Display name" autoComplete="nickname" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
          hint="At least 8 characters." error={pwShort ? 'Use at least 8 characters.' : null} />
        <Select label="Country (optional)" value={country} onChange={(e) => setCountry(e.target.value)}>
          {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </Select>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[var(--color-accent)]" />
          <span>I am 18 or older and accept the <Link to="/terms" className="text-accent underline">terms</Link> and <Link to="/privacy" className="text-accent underline">privacy notice</Link>.</span>
        </label>
        {reg.isError && <Notice tone="danger">{errorText(reg.error)}</Notice>}
        <Button type="submit" size="lg" className="w-full" disabled={reg.isPending || !name.trim() || !email || password.length < 8 || !adult}>
          {reg.isPending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthFrame>
  );
}
