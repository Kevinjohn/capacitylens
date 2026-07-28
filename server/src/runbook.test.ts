import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const runbook = readFileSync(fileURLToPath(new URL('../../docs/runbook.md', import.meta.url)), 'utf8')

describe('operations runbook', () => {
  it('includes an executable Compose named-volume restore path', () => {
    expect(runbook).toContain('docker compose stop api')
    expect(runbook).toContain('docker compose run --rm --no-deps --entrypoint sh api')
    expect(runbook).toContain('RESTORE_SNAPSHOT must not contain a path')
    expect(runbook).toContain('cp "$source" "$temporary"')
    expect(runbook).toContain('chmod 600 "$temporary"')
    expect(runbook).toContain('rm -f "$target-wal" "$target-shm"')
    expect(runbook).toContain('docker compose up -d api')
  })

  it('documents the process-wide authentication work limits and isolation boundary', () => {
    expect(runbook).toContain('process-wide availability safeguards, not per-company reservations')
    expect(runbook).toContain('Password authentication is identity-global and occurs before company selection')
    expect(runbook).toContain('edge/global quotas or separate CapacityLens instances')
  })
})
