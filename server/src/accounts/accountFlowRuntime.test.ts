import { describe, expect, it, vi } from 'vitest'
import { accountAuditWriter, recordTerminalOutcome } from './accountFlowRuntime'

describe('account flow runtime helpers', () => {
  it('constructs the shared audit envelope consistently', () => {
    const append = vi.fn(() => true)
    const audit = accountAuditWriter('application-1', { append })

    audit({
      action: 'flow.reconciliation_required',
      outcome: 'failed',
      command: { commandId: 'command-1', idempotencyKey: 'key-1' },
      targetPrincipalId: 'principal-1',
      changedFields: ['commandLedger'],
    })

    expect(append).toHaveBeenCalledWith({
      id: 'command-1:flow.reconciliation_required:failed',
      occurredAt: expect.any(String),
      applicationId: 'application-1',
      workspaceId: null,
      actorPrincipalId: null,
      targetPrincipalId: 'principal-1',
      commandId: 'command-1',
      action: 'flow.reconciliation_required',
      outcome: 'failed',
      changedFields: ['commandLedger'],
    })
  })

  it('preserves both the operation and terminal-recording failures', () => {
    const original = new Error('operation failed')
    const recording = new Error('ledger failed')

    expect(() =>
      recordTerminalOutcome(original, () => {
        throw recording
      }),
    ).toThrow(
      expect.objectContaining({
        errors: [original, recording],
        cause: recording,
      }),
    )
  })
})
