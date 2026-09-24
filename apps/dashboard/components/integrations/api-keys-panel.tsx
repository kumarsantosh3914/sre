'use client';

import { useState, type FormEvent } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/api';
import { ago } from '@/lib/format';
import type { ApiKey, CreatedApiKey } from '@/lib/types';
import { SkeletonRows } from '../ui/blocks';
import { Button } from '../ui/button';
import { Field, Input } from '../ui/field';
import { useToast } from '../ui/toast';
import { KeyReveal } from './key-reveal';

export function ApiKeysPanel({ onCreated }: { onCreated?: (key: CreatedApiKey) => void }) {
  const toast = useToast();
  const { data, mutate } = useSWR<ApiKey[]>('/api-keys');
  const [name, setName] = useState('');
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const create = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy('create');
    try {
      const key = await api<CreatedApiKey>('/api-keys', {
        method: 'POST',
        json: { name: name.trim() || 'default' },
      });
      setCreated(key);
      setName('');
      onCreated?.(key);
      void mutate();
    } catch (err) {
      toast('fault', err instanceof Error ? err.message : 'Couldn’t create the key.');
    } finally {
      setBusy(null);
    }
  };

  const rotate = async (key: ApiKey): Promise<void> => {
    if (
      !window.confirm(
        `Rotate “${key.name}”? The current key keeps working for 24 hours so you can update your alert sources.`,
      )
    )
      return;
    setBusy(key.id);
    try {
      setCreated(await api<CreatedApiKey>(`/api-keys/${key.id}/rotate`, { method: 'POST' }));
      void mutate();
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (key: ApiKey): Promise<void> => {
    if (
      !window.confirm(`Revoke “${key.name}” now? Alerts sent with it will be rejected immediately.`)
    )
      return;
    setBusy(key.id);
    try {
      await api(`/api-keys/${key.id}`, { method: 'DELETE' });
      toast('ok', 'Key revoked.');
      void mutate();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {created ? <KeyReveal created={created} /> : null}
      <form onSubmit={(e) => void create(e)} className="flex flex-wrap items-end gap-3">
        <Field label="New key name" className="w-full sm:w-64">
          {(p) => (
            <Input
              {...p}
              placeholder="alertmanager-prod"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          )}
        </Field>
        <Button type="submit" variant="ink" loading={busy === 'create'}>
          Create key
        </Button>
      </form>
      {!data ? (
        <SkeletonRows rows={2} />
      ) : data.length === 0 ? (
        <p className="text-base text-ink-3">
          No keys yet. Create one and paste it into your alerting tool.
        </p>
      ) : (
        <ul className="flex flex-col">
          {data.map((k) => (
            <li
              key={k.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b rule py-3"
            >
              <div className="min-w-0">
                <p className="text-base text-ink">{k.name}</p>
                <p className="text-sm text-ink-3">
                  <code className="font-mono text-xs">{k.displayPrefix}…</code> · used{' '}
                  {k.lastUsedAt ? ago(k.lastUsedAt) : 'never'}
                  {k.expiresAt ? (
                    <span className="text-signal"> · expires {ago(k.expiresAt)} (rotated)</span>
                  ) : null}
                </p>
              </div>
              <div className="flex gap-2">
                {!k.expiresAt ? (
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => void rotate(k)}
                    loading={busy === k.id}
                  >
                    Rotate
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void revoke(k)}
                  disabled={busy === k.id}
                >
                  Revoke
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
