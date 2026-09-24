import { render, screen } from '@testing-library/react';
import { RevisionTable } from '@/components/incident/revision-table';
import type { AuditEvent } from '@/lib/types';

const events: AuditEvent[] = [
  {
    id: 'a1',
    event: 'incident.created',
    actorType: 'system',
    actorId: null,
    before: null,
    after: null,
    metadata: {},
    at: '2026-09-24T19:37:47Z',
  },
  {
    id: 'a2',
    event: 'action.approved',
    actorType: 'slack',
    actorId: 'U42',
    before: null,
    after: null,
    metadata: { reason: 'Looks right' },
    at: '2026-09-24T19:39:00Z',
  },
];

describe('RevisionTable', () => {
  it('lists every audit event with a letter, a readable label and who did it', () => {
    render(<RevisionTable events={events} />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('Alert received — incident opened')).toBeInTheDocument();
    expect(screen.getByText('Action approved')).toBeInTheDocument();
    expect(screen.getByText('Looks right')).toBeInTheDocument();
    // "By" column plus the phone fold-under line.
    expect(screen.getAllByText(/Slack U42/).length).toBeGreaterThan(0);
  });
});
