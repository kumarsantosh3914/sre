import { flatConfig, toPayload, webhookBase, type IntegrationDef } from '@/lib/integrations';

const def: IntegrationDef = {
  type: 'grafana',
  name: 'Test',
  group: 'alerts',
  summary: '',
  fields: [
    { key: 'url', label: 'URL', kind: 'config' },
    { key: 'ecs.cluster', label: 'Cluster', kind: 'config' },
    { key: 'apiToken', label: 'Token', kind: 'credential', type: 'password' },
  ],
};

describe('integrations', () => {
  it('splits form values into nested config and credentials, dropping blanks', () => {
    expect(
      toPayload(def, { url: ' https://g.example ', 'ecs.cluster': 'prod', apiToken: '' }),
    ).toEqual({ config: { url: 'https://g.example', ecs: { cluster: 'prod' } }, credentials: {} });
  });

  it('flattens stored config back into dotted form keys', () => {
    expect(
      flatConfig({ url: 'https://g.example', ecs: { cluster: 'prod' }, missing: null }),
    ).toEqual({
      url: 'https://g.example',
      'ecs.cluster': 'prod',
    });
  });

  it('derives the webhook base from a key-bearing prometheus URL', () => {
    expect(
      webhookBase({ prometheus: 'https://sre.example/webhooks/prometheus/sreai_abc123' }),
    ).toBe('https://sre.example/webhooks');
  });
});
