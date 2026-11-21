import { test } from '@japa/runner';
import { FIXTURE_TIME_OFF } from '@capacitylens/shared/data/fixtures';
import TimeOff from '#models/time_off';
import { encodeRow } from '#services/state_repository';
import { transformRow } from '#transformers/row_transformer';

test('produces a stored row in its wire shape and key order, without deletion metadata', ({
  assert,
}) => {
  const stored = TimeOff.$createFromAdapterResult({
    ...encodeRow('time_off', { ...FIXTURE_TIME_OFF }),
    deleted_at: null,
    deletion_group_id: 'group-1',
  });
  if (!stored) throw new Error('The stored row did not load');
  const row = transformRow(stored);
  assert.deepEqual(row, { ...FIXTURE_TIME_OFF });
  assert.deepEqual(Object.keys(row), [
    'companyId',
    'createdAt',
    'endDate',
    'id',
    'note',
    'resourceId',
    'startDate',
    'type',
    'updatedAt',
  ]);
});
