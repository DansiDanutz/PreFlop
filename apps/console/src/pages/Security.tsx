import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { MfaSetup } from '@preflop/client';
import { Button, Card, Wordmark } from '@preflop/ui';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { errorMessage } from '../lib/format.ts';
import { Callout, CopyButton, Field, TextInput } from '../components/ui.tsx';

/**
 * /account/security: two-factor authentication (TOTP) and password. While
 * settings.require_staff_mfa is on, a PreFlop team account without 2FA lands here and can use
 * nothing else until it has enrolled.
 */
export function SecurityPage() {
  const { me, logout } = useAuth();
  const required = !!me?.mfa_enrollment_required;
  return (
    <div className="min-h-screen bg-bg px-4 py-10">
      <div className="mx-auto w-full max-w-xl space-y-6">
        <div className="flex items-center justify-between">
          <Wordmark />
          {required ? <button type="button" className="text-sm text-muted hover:text-ink" onClick={() => void logout()}>Sign out</button>
            : <Link to="/" className="text-sm text-muted hover:text-ink">Back to the console</Link>}
        </div>
        <div>
          <h1 className="font-serif text-3xl tracking-[-0.02em]">Sign-in security</h1>
          <p className="mt-1 text-sm text-muted">{me?.email}</p>
        </div>
        {required && (
          <Callout tone="warn" title="Two-factor authentication is required">
            PreFlop team accounts must use an authenticator app. Set it up below to continue to the console.
          </Callout>
        )}
        <TwoFactor />
        <ChangePassword staff={!!me?.platform_role} />
      </div>
    </div>
  );
}

function TwoFactor() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setErr(null); setDone(null);
    try {
      await fn();
      setDone(ok);
      setCode('');
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  const enabled = !!me?.mfa_enabled;
  const codeOk = /^\d{6}$/.test(code);
  return (
    <Card className="space-y-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Two-factor authentication</h2>
        <span className={enabled ? 'text-sm font-semibold text-accent' : 'text-sm text-muted'}>{enabled ? 'On' : 'Off'}</span>
      </div>
      {!enabled && !setup && (
        <>
          <p className="text-sm text-ink/85">Use an authenticator app (1Password, Google Authenticator, Authy…). After setup, signing in asks for a 6-digit code.</p>
          <Button disabled={busy} onClick={() => void run(async () => setSetup(await api.mfaSetup()), '')}>Set up two-factor authentication</Button>
        </>
      )}
      {!enabled && setup && (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (codeOk) void run(() => api.mfaEnable(code), 'Two-factor authentication is on.'); }}>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-ink/85">
            <li>In your authenticator app, add an account with this setup key (time-based, 6 digits, 30 seconds), or open the otpauth link on the device that has the app.</li>
            <li>Enter the code the app shows.</li>
          </ol>
          <div className="space-y-2">
            <div className="text-[13px] font-medium text-muted">Setup key</div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-[10px] border border-line-strong bg-bg px-3 py-2.5 font-mono text-[13px] tracking-wider text-accent">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
              <CopyButton text={setup.secret} />
            </div>
            <div className="text-[13px] font-medium text-muted">otpauth link</div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-[10px] border border-line-strong bg-bg px-3 py-2.5 font-mono text-[12px] text-ink/85">{setup.otpauth_uri}</code>
              <CopyButton text={setup.otpauth_uri} />
            </div>
            <p className="text-xs text-faint">Keep the key private: anyone who has it can generate your codes.</p>
          </div>
          <Field label="Code from the app">
            {(p) => <TextInput {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}
          </Field>
          <Button type="submit" disabled={busy || !codeOk}>Turn on</Button>
        </form>
      )}
      {enabled && (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (codeOk) void run(() => api.mfaDisable(code), 'Two-factor authentication is off.'); }}>
          <p className="text-sm text-ink/85">Signing in asks for a code from your authenticator app. To turn it off (for example, to move to a new phone and set it up again), enter a current code.</p>
          <Field label="Current code">
            {(p) => <TextInput {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}
          </Field>
          <Button type="submit" variant="danger" disabled={busy || !codeOk}>Turn off</Button>
        </form>
      )}
      {err && <Callout tone="danger">{err}</Callout>}
      {done && <Callout tone="accent">{done}</Callout>}
    </Card>
  );
}

function ChangePassword({ staff }: { staff: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const min = staff ? 12 : 8;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null); setOk(false);
    try {
      await api.changePassword(current, next);
      setOk(true); setCurrent(''); setNext('');
    } catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
  };
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Password</h2>
      <form className="mt-4 space-y-4" onSubmit={submit}>
        <Field label="Current password">
          {(p) => <TextInput {...p} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
        </Field>
        <Field label="New password" hint={staff ? 'At least 12 characters and 3 of: lowercase, uppercase, digits, symbols. Other sessions are signed out.' : 'At least 8 characters. Other sessions are signed out.'}>
          {(p) => <TextInput {...p} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
        </Field>
        <Button type="submit" variant="secondary" disabled={busy || !current || next.length < min}>Change password</Button>
        {err && <Callout tone="danger">{err}</Callout>}
        {ok && <Callout tone="accent">Password changed. Your other sessions are signed out.</Callout>}
      </form>
    </Card>
  );
}
