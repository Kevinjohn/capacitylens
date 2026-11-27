import { describe, expect, it } from 'vitest'
import { SCOPED_KEYS } from '@capacitylens/shared/types/entities'
import { buildSkippedMessage, summarize } from './importExportMessages'

describe('import messages', () => {
  it('names skipped records for the no-records reason and the success note', () => {
    expect(buildSkippedMessage(0, 'why')).toBe('')
    expect(buildSkippedMessage(1, 'why')).toBe(' — 1 invalid record skipped')
    expect(buildSkippedMessage(3, 'why')).toBe(' — 3 invalid records skipped')
    expect(buildSkippedMessage(1, 'note')).toBe(' (1 invalid record skipped)')
    expect(buildSkippedMessage(2, 'note')).toBe(' (2 invalid records skipped)')
  })

  it('summarises only the tables that hold rows', () => {
    const none = Object.fromEntries(SCOPED_KEYS.map((key) => [key, 0])) as Parameters<
      typeof summarize
    >[0]
    expect(summarize({ ...none, resources: 1, allocations: 1 })).toBe('1 resources, 1 allocations')
    expect(summarize(none)).toBe('no entities')
  })
})
