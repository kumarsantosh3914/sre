'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthSheet } from '@/components/shell/auth-sheet';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ tenantName: '', email: '', password: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form | 'form', string>>>({});
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const next: typeof errors = {};
    if (form.tenantName.trim().length < 2)
      next.tenantName = 'Give your workspace a name (at least 2 characters).';
    if (!/^\S+@\S+\.\S+$/.test(form.email)) next.email = 'Enter a valid email address.';
    if (form.password.length < 8) next.password = 'Use at least 8 characters.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      await register(form.tenantName.trim(), form.email, form.password);
      router.replace('/onboarding');
    } catch (err) {
      setErrors(
        err instanceof ApiError && err.status === 409
          ? { email: 'An account with this email already exists. Sign in instead.' }
          : { form: 'Couldn’t create the workspace. Try again in a moment.' },
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthSheet
      title="Create your workspace"
      lede="About ten minutes from here to your first cited diagnosis."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-ink underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
        <Field label="Company or team" error={errors.tenantName}>
          {(p) => (
            <Input
              {...p}
              autoComplete="organization"
              value={form.tenantName}
              onChange={set('tenantName')}
            />
          )}
        </Field>
        <Field label="Work email" error={errors.email}>
          {(p) => (
            <Input
              {...p}
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={set('email')}
            />
          )}
        </Field>
        <Field label="Password" hint="At least 8 characters." error={errors.password}>
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={set('password')}
            />
          )}
        </Field>
        {errors.form ? (
          <p role="alert" className="text-sm text-fault">
            {errors.form}
          </p>
        ) : null}
        <Button type="submit" variant="ink" size="lg" loading={busy} className="mt-1">
          Create workspace
        </Button>
      </form>
    </AuthSheet>
  );
}
