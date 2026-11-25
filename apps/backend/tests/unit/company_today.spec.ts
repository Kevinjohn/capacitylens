import { test } from '@japa/runner';
import { readCompanyToday } from '#services/company_today';

test.group('company today', () => {
  test('reads the date in the company time zone, not in UTC', ({ assert }) => {
    const now = Date.parse('2026-06-14T10:30:00Z');
    assert.equal(readCompanyToday('Pacific/Kiritimati', undefined, now), '2026-06-15');
    assert.equal(readCompanyToday('UTC', undefined, now), '2026-06-14');
    assert.equal(
      readCompanyToday('America/Los_Angeles', undefined, Date.parse('2026-06-15T05:00:00Z')),
      '2026-06-14'
    );
  });

  test('uses Etc/GMT for a company without a time zone', ({ assert, cleanup }) => {
    // A host zone already past midnight shows the default is not the server's own zone.
    const hostZone = process.env.TZ;
    cleanup(() => {
      if (hostZone === undefined) delete process.env.TZ;
      else process.env.TZ = hostZone;
    });
    process.env.TZ = 'Pacific/Kiritimati';
    assert.equal(
      readCompanyToday(null, undefined, Date.parse('2026-06-14T23:30:00Z')),
      '2026-06-14'
    );
  });

  test('returns the fixed date in place of the clock', ({ assert }) => {
    assert.equal(
      readCompanyToday('Pacific/Kiritimati', '2026-06-03', Date.parse('2026-06-14T10:30:00Z')),
      '2026-06-03'
    );
  });

  test('refuses an invalid stored time zone', ({ assert }) => {
    assert.throws(
      () => readCompanyToday('Not/AZone', undefined, Date.now()),
      'The company time zone is invalid.'
    );
  });
});
