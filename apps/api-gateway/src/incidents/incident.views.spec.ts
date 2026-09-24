import { AuditLog } from '@sreai/database';
import { AuditActorType } from '@sreai/shared';
import { auditCsv } from './incident.views';

describe('auditCsv', () => {
  it('quotes every cell and neutralises spreadsheet formulas', () => {
    const csv = auditCsv([
      {
        createdAt: new Date('2026-09-15T03:14:00Z'),
        event: '=HYPERLINK("http://evil")',
        actorType: AuditActorType.SYSTEM,
        actorId: null,
        before: null,
        after: { status: 'acting' },
        metadata: { note: 'say "hi"' },
      } as unknown as AuditLog,
    ]);
    const [, row] = csv.split('\n');
    expect(row).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(row).toContain('"{""status"":""acting""}"');
  });
});
