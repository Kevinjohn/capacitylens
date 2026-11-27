import { test } from '@japa/runner'
import { FIXTURE_TIME_OFF } from '@capacitylens/shared/data/fixtures'
import TimeOff from '#models/time_off'
import { transformRow } from '#transformers/row_transformer'

test('produces a stored row in its wire shape and key order, without deletion metadata', ({
  assert,
}) => {
  const stored = TimeOff.$createFromAdapterResult({
    company_id: FIXTURE_TIME_OFF.companyId,
    created_at: FIXTURE_TIME_OFF.createdAt,
    end_date: FIXTURE_TIME_OFF.endDate,
    id: FIXTURE_TIME_OFF.id,
    note: FIXTURE_TIME_OFF.note,
    resource_id: FIXTURE_TIME_OFF.resourceId,
    start_date: FIXTURE_TIME_OFF.startDate,
    type: FIXTURE_TIME_OFF.type,
    updated_at: FIXTURE_TIME_OFF.updatedAt,
    deleted_at: null,
    deletion_group_id: 'group-1',
  })
  if (!stored) throw new Error('The stored row did not load')
  const row = transformRow(stored)
  assert.deepEqual(row, { ...FIXTURE_TIME_OFF })
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
  ])
})
