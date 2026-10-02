import type { OrgKind } from '@preflop/client';
import { Button, Card } from '@preflop/ui';
import { useMutation } from '@tanstack/react-query';
import { CircleCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '../../lib/api.ts';
import { errorText, isNotImplemented } from '../../lib/problems.ts';
import { Field, Notice, TextArea } from '../ui.tsx';

export interface ExtraField { key: string; label: string; placeholder?: string; type?: string; required?: boolean }

/** Application form posting to POST /v1/applications with the given kind. */
export function ApplicationForm({ kind, nameLabel, extra, title }: { kind: OrgKind; nameLabel: string; extra: ExtraField[]; title: string }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const apply = useMutation({
    mutationFn: () => api.apply({ kind, name: name.trim(), email: email.trim(), details: { ...values, message, source: 'website' } }),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); apply.mutate(); };

  if (apply.isSuccess) {
    return (
      <Card className="flex flex-col items-center gap-3 p-10 text-center" role="status">
        <CircleCheck className="h-10 w-10 text-accent" aria-hidden />
        <h3 className="font-serif text-3xl">Application received</h3>
        <p className="max-w-[420px] text-muted">Thank you. Our team reviews every application and will reply to {email} within a few working days.</p>
      </Card>
    );
  }
  return (
    <Card className="p-6 sm:p-8">
      <h3 className="font-serif text-3xl">{title}</h3>
      <form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field label={nameLabel} required value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Work email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        {extra.map((f) => (
          <Field key={f.key} label={f.label} type={f.type ?? 'text'} required={f.required ?? false} placeholder={f.placeholder}
            value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
        ))}
        <TextArea label="Anything else we should know?" className="sm:col-span-2" value={message} onChange={(e) => setMessage(e.target.value)} />
        {apply.isError && (
          <Notice tone="warn" className="sm:col-span-2">
            {isNotImplemented(apply.error) ? 'Applications open soon. Please try again in a little while.' : errorText(apply.error)}
          </Notice>
        )}
        <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
          <Button type="submit" size="lg" disabled={apply.isPending || !name.trim() || !email.trim()}>{apply.isPending ? 'Sending…' : 'Send application'}</Button>
          <span className="text-xs text-muted">We only use these details to review your application.</span>
        </div>
      </form>
    </Card>
  );
}
