'use client';

import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { setupSnippet, webhookBase } from '@/lib/integrations';
import type { CreatedApiKey } from '@/lib/types';
import { cx } from '../ui/cx';
import { CodeBlock, CopyField } from '../ui/copy-field';

const SOURCES = [
  { id: 'prometheus', label: 'Alertmanager' },
  { id: 'grafana', label: 'Grafana' },
  { id: 'sentry', label: 'Sentry' },
  { id: 'cloudwatch', label: 'CloudWatch' },
  { id: 'generic', label: 'Generic' },
];

// The one moment a key is visible: the key, and ready-to-paste setup for
// each alert source with the key already filled in.
export function KeyReveal({
  created,
  initialSource = 'prometheus',
}: {
  created: CreatedApiKey;
  initialSource?: string;
}) {
  const [source, setSource] = useState(initialSource);
  const snippet = setupSnippet(source, webhookBase(created.webhookUrls), created.key);
  return (
    <div className="flex flex-col gap-4 border border-signal/60 p-4">
      <p className="flex items-start gap-2 text-base text-ink">
        <KeyRound aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
        <span>
          <strong className="font-semibold">Copy this key now.</strong> It’s stored only as a hash —
          you won’t be able to see it again.
        </span>
      </p>
      <CopyField value={created.key} label="API key" secret />

      <div className="flex flex-col gap-3">
        <div
          role="tablist"
          aria-label="Alert source"
          className="flex flex-wrap gap-1 border-b rule-strong"
        >
          {SOURCES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={source === s.id}
              onClick={() => setSource(s.id)}
              className={cx(
                '-mb-px border-b-2 px-3 py-2 text-sm transition-colors duration-150',
                source === s.id
                  ? 'border-signal font-semibold text-ink'
                  : 'border-transparent text-ink-2 hover:text-ink',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        {snippet ? (
          <div role="tabpanel" className="flex flex-col gap-3">
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-base text-ink-2 marker:text-ink-3">
              {snippet.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <CodeBlock code={snippet.code} label={snippet.title} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
