import { test } from '@japa/runner';
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

  test('uses Etc/GMT for a company without a time zone', ({ assert }) => {
    assert.equal(readCompanyToday(null, Date.parse('2026-06-14T23:30:00Z')), '2026-06-14');
  });

  test('refuses an invalid stored time zone', ({ assert }) => {
    assert.throws(() => readCompanyToday('Not/AZone'), 'The company time zone is invalid.');
  });
});
