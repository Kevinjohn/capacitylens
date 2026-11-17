import { test } from '@japa/runner';
import env from '#start/env';
import { readCompanyToday } from '#services/company_today';

test.group('company today', () => {
  test('reads the date in the company time zone, not in UTC', ({ assert }) => {
    const now = Date.parse('2026-06-14T10:30:00Z');
    assert.equal(readCompanyToday('Pacific/Kiritimati', now), '2026-06-15');
    assert.equal(readCompanyToday('UTC', now), '2026-06-14');
    assert.equal(
      readCompanyToday('America/Los_Angeles', Date.parse('2026-06-15T05:00:00Z')),
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
    assert.equal(readCompanyToday(null, Date.parse('2026-06-14T23:30:00Z')), '2026-06-14');
  });

  test('returns the pinned date when CAPACITYLENS_FIXED_TODAY is set', ({ assert, cleanup }) => {
    const pinned = env.get('CAPACITYLENS_FIXED_TODAY');
    cleanup(() => env.set('CAPACITYLENS_FIXED_TODAY', pinned ?? ''));
    env.set('CAPACITYLENS_FIXED_TODAY', '2026-06-03');
    assert.equal(
      readCompanyToday('Pacific/Kiritimati', Date.parse('2026-06-14T10:30:00Z')),
      '2026-06-03'
    );
  });

  test('refuses an invalid stored time zone', ({ assert }) => {
    assert.throws(() => readCompanyToday('Not/AZone'), 'The company time zone is invalid.');
  });
});
