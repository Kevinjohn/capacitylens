import type {
  ClientMasqueradeEndReason,
  MasqueradeState,
  MasqueradeStatus,
} from '@capacitylens/shared/domain/masquerade'
import type { masqueradeApi } from './masqueradeApi'
import type { StoreState } from '@/store/types'
import {
  publishMasqueradeCompany,
  restoreMasqueradeProjection,
} from './masqueradeProjectionRecovery'
import type { FinishProjectionResult } from './masqueradeProjectionRecovery'

export type FlushPendingWritesResult = { kind: 'clean' } | { kind: 'blocked' }
type RefreshOutcome = { kind: 'reloaded' } | { kind: 'failed' }

interface ReleaseSuspensionInput {
  dropParkedEdits: boolean
}

interface BeginStartInput {
  generation: number
  companyId: string
  targetUserId: string
  flush: FlushPendingWritesResult
}

interface EndProjectionInput {
  reason: ClientMasqueradeEndReason
  finish: (state: MasqueradeState) => Promise<FinishProjectionResult>
  failureMessage: string
  options: { onNoState: NoStateMode }
}

type ResumeWrites = (options?: { dropParkedEdits?: boolean }) => void
type EndProjectionResult =
  { kind: 'inactive' } | { kind: 'superseded' } | { kind: 'noop' } | { kind: 'failed' }
type NoStateMode = 'succeed' | 'wait'

function isSwitchSuccessful(outcome: RefreshOutcome): boolean {
  return outcome.kind === 'reloaded'
}

/** Store and persistence operations required to switch masquerade companies safely. */
export interface MasqueradeModelDependencies {
  flush: () => Promise<FlushPendingWritesResult>
  suspend: () => ResumeWrites | null
  reproject: (companyId: string, includeCompanySummaries?: boolean) => Promise<boolean>
  switchCompany: (companyId: string | null) => Promise<RefreshOutcome>
  readBootstrapCompany: (companyId: string) => Promise<string | null>
  api: typeof masqueradeApi
  /** The store state this model reads and writes; the model reaches no other state. */
  readState: () => StoreState
  /** The one writer of the masquerade context proof the data layer sends with each request. */
  setMasqueradeToken: (token: string | null) => void
}

/** Sole owner of the persistence suspension used by identity masquerade transitions. */
export class MasqueradeModel {
  readonly #dependencies: MasqueradeModelDependencies
  #resumeWrites: ResumeWrites | null = null
  #generation = 0
  #startPendingGeneration: number | null = null

  constructor(dependencies: MasqueradeModelDependencies) {
    this.#dependencies = dependencies
  }

  get #store(): StoreState {
    return this.#dependencies.readState()
  }

  /** Revoke every in-flight projection before an outgoing identity can publish again. */
  invalidate(): void {
    ++this.#generation
    this.#startPendingGeneration = null
    this.#releaseSuspension({ dropParkedEdits: true })
    this.#dependencies.setMasqueradeToken(null)
    this.#store.setMasquerade({ kind: 'inactive' })
  }

  #acquireSuspension(): boolean {
    if (this.#resumeWrites) return true
    this.#resumeWrites = this.#dependencies.suspend()
    return this.#resumeWrites !== null
  }

  #releaseSuspension({ dropParkedEdits }: ReleaseSuspensionInput): void {
    const resume = this.#resumeWrites
    this.#resumeWrites = null
    resume?.({ dropParkedEdits })
  }

  #fail(message: string): false {
    this.#store.setNotice(message, 'error')
    return false
  }

  #ownsRuntime(generation: number, kind: 'starting' | 'active' | 'ending'): boolean {
    const runtime = this.#store.masquerade
    return (
      runtime.kind === kind && runtime.generation === generation && this.#generation === generation
    )
  }

  /** Capture the owning projection so a late status read cannot replace a newer transition. */
  captureStatusReconciliation(): () => boolean {
    const generation = this.#generation
    const companyId = this.#store.activeCompanyId
    const runtime = this.#store.masquerade
    return () =>
      this.#generation === generation &&
      this.#store.activeCompanyId === companyId &&
      this.#store.masquerade === runtime
  }

  async #reconcileStatusAfterContextError(): Promise<void> {
    const isCurrent = this.captureStatusReconciliation()
    try {
      const status = await this.#dependencies.api.status(this.#store.activeCompanyId ?? undefined)
      if (isCurrent()) await this.adoptStatus(status)
    } catch (error) {
      console.warn('Masquerade context status could not be reconciled', error)
    }
  }

  #beginStartAfterFlush({ generation, companyId, targetUserId, flush }: BeginStartInput): boolean {
    if (this.#startPendingGeneration !== generation) return false
    this.#startPendingGeneration = null
    if (this.#generation !== generation) return false
    if (this.#store.masquerade.kind !== 'inactive') return false
    if (flush.kind !== 'clean' || !this.#store.planningReadyForReplacement()) {
      return this.#fail(
        'Finish loading or resolving company changes before starting View as member.'
      )
    }
    if (!this.#acquireSuspension()) {
      return this.#fail(
        'Finish loading or resolving company changes before starting View as member.'
      )
    }
    this.#store.setMasquerade({
      kind: 'starting',
      pending: { companyId, targetUserId },
      generation,
    })
    return true
  }

  #failOwnedStart(generation: number, error: unknown): false {
    if (!this.#ownsRuntime(generation, 'starting')) return false
    this.#releaseSuspension({ dropParkedEdits: false })
    this.#store.setMasquerade({ kind: 'inactive' })
    return this.#fail(
      error instanceof Error ? error.message : 'View as member could not be started.'
    )
  }

  async #finishStartProjection(
    generation: number,
    companyId: string,
    state: MasqueradeState
  ): Promise<boolean> {
    try {
      const projected = await this.#dependencies.reproject(companyId, false)
      if (!this.#ownsRuntime(generation, 'starting')) return false
      if (!projected) {
        return this.#fail(
          'View as member started, but its data could not be loaded. Retry or end it.'
        )
      }
    } catch (error) {
      // A failed target projection must remain visible only to its owning masquerade generation.
      if (!this.#ownsRuntime(generation, 'starting')) return false
      console.error('Masquerade target projection could not be loaded', error)
      return this.#fail(
        'View as member started, but its data could not be loaded. Retry or end it.'
      )
    }
    publishMasqueradeCompany(this.#store, state)
    this.#store.setMasquerade({ kind: 'active', state, generation })
    return true
  }

  async start(companyId: string, targetUserId: string): Promise<boolean> {
    // Not fail(): the in-flight start usually succeeds, and an error notice is created with
    // duration Infinity, so a double-click would leave a permanent error banner over a working
    // masquerade. This is ordinary feedback about a duplicate click, not a failure.
    if (this.#startPendingGeneration !== null) {
      this.#store.setNotice('View as member is already starting.', 'info')
      return false
    }
    if (this.#store.masquerade.kind !== 'inactive') {
      return this.#fail('End the current View as member before starting another.')
    }
    const generation = ++this.#generation
    this.#startPendingGeneration = generation
    let flush: FlushPendingWritesResult
    try {
      flush = await this.#dependencies.flush()
    } catch (error) {
      // Release the pending start claim and show the save failure only while this start generation still owns the UI.
      if (this.#startPendingGeneration !== generation) return false
      this.#startPendingGeneration = null
      if (this.#generation !== generation) return false
      return this.#fail(
        error instanceof Error ? error.message : 'Pending changes could not be saved.'
      )
    }
    if (!this.#beginStartAfterFlush({ generation, companyId, targetUserId, flush })) return false
    if (!this.#ownsRuntime(generation, 'starting')) return false
    let state: MasqueradeState
    try {
      state = await this.#dependencies.api.start(companyId, targetUserId)
    } catch (error) {
      // Preserve start-generation ownership while surfacing a refused or failed masquerade start.
      return this.#failOwnedStart(generation, error)
    }
    if (!this.#ownsRuntime(generation, 'starting')) return false
    this.#dependencies.setMasqueradeToken(state.token)
    this.#store.setMasquerade({
      kind: 'starting',
      pending: { companyId, targetUserId },
      state,
      generation,
    })
    return this.#finishStartProjection(generation, companyId, state)
  }

  async retryProjection(): Promise<boolean> {
    const runtime = this.#store.masquerade
    if (runtime.kind === 'inactive') return false
    const state = runtime.state
    if (!state) return false
    const generation = runtime.generation
    if (this.#store.activeCompanyId === null) {
      return this.#loadColdProjection(state, generation)
    }
    if (!this.#acquireSuspension()) {
      return this.#fail(
        'Finish loading or resolving company changes before retrying View as member.'
      )
    }
    try {
      const projected = await this.#dependencies.reproject(state.companyId, false)
      if (!this.#ownsRuntime(generation, runtime.kind)) return false
      if (!projected) {
        return this.#fail('View as member could not be loaded.')
      }
    } catch (error) {
      // Keep a failed projection retry visible without letting an older generation overwrite the current view.
      if (!this.#ownsRuntime(generation, runtime.kind)) return false
      console.error('Masquerade projection retry failed', error)
      return this.#fail('View as member could not be loaded.')
    }
    publishMasqueradeCompany(this.#store, state)
    this.#store.setMasquerade({ kind: 'active', state, generation })
    return true
  }

  async end(
    reason: ClientMasqueradeEndReason = 'explicit',
    navigate?: (to: string) => void
  ): Promise<boolean> {
    const runtime = this.#store.masquerade
    // A selected company can still lack a trustworthy projection after its first canonical read fails.
    // Once End is confirmed, show company recovery rather than expose that unread projection.
    const cold =
      this.#store.activeCompanyId === null || (runtime.kind === 'starting' && !this.#resumeWrites)
    const ended = await this.#endProjection({
      reason,
      finish: async (state) => {
        if (cold) {
          const outcome = await this.#dependencies.switchCompany(null)
          return isSwitchSuccessful(outcome)
            ? { kind: 'finished' }
            : {
                kind: 'failed',
                message:
                  'The real account view could not be restored. Retry ending View as member.',
              }
        }
        if (!(await this.#dependencies.reproject(state.companyId))) {
          return {
            kind: 'failed',
            message: 'The real account view could not be restored. Retry ending View as member.',
          }
        }
        return { kind: 'finished' }
      },
      failureMessage: 'View as member could not be ended.',
      options: { onNoState: 'succeed' },
    })
    if (ended.kind === 'inactive') navigate?.('/')
    return ended.kind !== 'failed'
  }

  async transitionCompany(companyId: string | null): Promise<boolean> {
    const runtime = this.#store.masquerade
    if (runtime.kind === 'inactive') {
      // A start still flushing belongs to the old company and must not run after the switch.
      if (this.#startPendingGeneration !== null) {
        ++this.#generation
        this.#startPendingGeneration = null
      }
      return isSwitchSuccessful(await this.#dependencies.switchCompany(companyId))
    }
    const ended = await this.#endProjection({
      reason: 'company_switch',
      finish: async () => {
        const outcome = await this.#dependencies.switchCompany(companyId)
        if (!isSwitchSuccessful(outcome)) {
          return { kind: 'failed', message: 'The selected company could not be loaded.' }
        }
        return { kind: 'finished' }
      },
      failureMessage: 'The company switch could not be completed.',
      options: { onNoState: 'wait' },
    })
    if (ended.kind === 'superseded') {
      return this.#fail('A newer View as member is active. End it before switching companies.')
    }
    return ended.kind === 'inactive'
  }

  async #endProjection({
    reason,
    finish,
    failureMessage,
    options,
  }: EndProjectionInput): Promise<EndProjectionResult> {
    const runtime = this.#store.masquerade
    const state = runtime.kind === 'inactive' ? null : runtime.state
    if (!state) {
      if (options.onNoState === 'succeed') return { kind: 'noop' }
      this.#fail('Wait for the current View as member change to finish.')
      return { kind: 'failed' }
    }
    const cold =
      runtime.kind !== 'inactive' && this.#store.activeCompanyId === null && !this.#resumeWrites
    if (!cold && !this.#acquireSuspension()) {
      this.#fail('Finish loading or resolving company changes before ending View as member.')
      return { kind: 'failed' }
    }
    const generation = ++this.#generation
    this.#store.setMasquerade({ kind: 'ending', state, generation })
    try {
      await this.#dependencies.api.end(state.token, reason)
      if (!this.#ownsRuntime(generation, 'ending')) return { kind: 'superseded' }
      const projection = await this.#restoreEndingProjection(state, generation, finish)
      if (projection.kind === 'active') {
        await this.retryProjection()
        return { kind: 'superseded' }
      }
      if (projection.kind === 'superseded') return { kind: 'superseded' }
      if (projection.kind === 'failed') return { kind: 'failed' }
      this.#releaseSuspension({ dropParkedEdits: true })
      this.#store.setMasquerade({ kind: 'inactive' })
      return { kind: 'inactive' }
    } catch (error) {
      // Return a typed failed outcome only to the owning end generation so stale completions cannot change current recovery state.
      if (!this.#ownsRuntime(generation, 'ending')) return { kind: 'superseded' }
      this.#fail(error instanceof Error ? error.message : failureMessage)
      try {
        const projection = await this.#restoreEndingProjection(state, generation, finish)
        if (projection.kind === 'superseded') return { kind: 'superseded' }
        if (projection.kind === 'failed') return { kind: 'failed' }
        if (projection.kind === 'active') {
          return (await this.retryProjection()) ? { kind: 'superseded' } : { kind: 'failed' }
        }
        if (!this.#ownsRuntime(generation, 'ending')) return { kind: 'superseded' }
        this.#releaseSuspension({ dropParkedEdits: true })
        this.#store.setMasquerade({ kind: 'inactive' })
        return { kind: 'inactive' }
      } catch (reconciliationError) {
        console.warn('Masquerade end status could not be reconciled', reconciliationError)
      }
      return { kind: 'failed' }
    }
  }

  /** Adopt status before PermissionProvider publishes an effective role, preventing a writable frame. */
  async adoptStatus(status: MasqueradeStatus): Promise<void> {
    this.#dependencies.setMasqueradeToken(status.masqueradeToken)
    if (!status.active) {
      const current = this.#store.masquerade
      if (current.kind === 'starting' && current.state && this.#store.activeCompanyId === null) {
        ++this.#generation
        this.#store.setMasquerade({ kind: 'inactive' })
        return
      }
      if (current.kind === 'active' || current.kind === 'starting') {
        this.restoreServerEndedProjection()
      }
      return
    }
    await this.#adoptActiveStatus(status)
  }

  async #adoptActiveStatus(status: Extract<MasqueradeStatus, { active: true }>): Promise<void> {
    const current = this.#store.masquerade
    // The model already owns these transitions. A membership invalidation triggered by its
    // own reproject must not publish `active` before that authoritative reload has completed.
    if (current.kind === 'starting') {
      if (current.state?.token === status.token) {
        if (!this.#resumeWrites) await this.retryProjection()
        return
      }
    }
    if (current.kind === 'ending') return
    if (
      current.kind === 'active' &&
      current.state.token === status.token &&
      current.state.companyId === status.companyId &&
      current.state.targetUserId === status.targetUserId &&
      current.state.effectiveRole === status.effectiveRole
    ) {
      return
    }
    const generation = ++this.#generation
    if (this.#store.activeCompanyId === null) {
      this.#store.setMasquerade({
        kind: 'starting',
        pending: { companyId: status.companyId, targetUserId: status.targetUserId },
        state: status,
        generation,
      })
      await this.#loadColdProjection(status, generation)
      return
    }
    this.#store.setMasquerade({
      kind: 'starting',
      pending: { companyId: status.companyId, targetUserId: status.targetUserId },
      state: status,
      generation,
    })
    if (!this.#acquireSuspension()) {
      this.#fail('Finish loading or resolving company changes before entering View as member.')
      return
    }
    await this.#finishStartProjection(generation, status.companyId, status)
  }

  async #loadColdProjection(state: MasqueradeState, generation: number): Promise<boolean> {
    try {
      const name = await this.#dependencies.readBootstrapCompany(state.companyId)
      if (!this.#ownsRuntime(generation, 'starting')) return false
      if (name === null) {
        return this.#fail('View as member could not be loaded. Retry or end it.')
      }
      this.#store.setCompanySummaries({
        list: [{ id: state.companyId, name, role: state.effectiveRole }],
        complete: true,
      })
      this.#store.setActiveCompany(state.companyId)
      if (!(await this.#dependencies.reproject(state.companyId, false))) {
        if (this.#ownsRuntime(generation, 'starting')) {
          return this.#fail('View as member could not be loaded. Retry or end it.')
        }
        return false
      }
      if (!this.#ownsRuntime(generation, 'starting')) return false
      if (!this.#acquireSuspension()) {
        return this.#fail('View as member could not be loaded. Retry or end it.')
      }
      publishMasqueradeCompany(this.#store, state)
      const loadedName =
        this.#store.data.companies.find((company) => company.id === state.companyId)?.name ?? name
      this.#store.setCompanySummaries({
        list: [{ id: state.companyId, name: loadedName, role: state.effectiveRole }],
        complete: true,
      })
      this.#store.setMasquerade({ kind: 'active', state, generation })
      return true
    } catch (error) {
      if (!this.#ownsRuntime(generation, 'starting')) return false
      console.error('Masquerade projection could not be loaded', error)
      return this.#fail('View as member could not be loaded. Retry or end it.')
    }
  }

  /** A projected read reported that server-side revalidation ended this session's masquerade. */
  restoreServerEndedProjection(): void {
    const runtime = this.#store.masquerade
    if (runtime.kind === 'inactive') {
      void this.#reconcileStatusAfterContextError()
      return
    }
    if (runtime.kind === 'ending') return
    const state = runtime.state
    if (!state) return
    if (!this.#acquireSuspension()) return
    const generation = ++this.#generation
    this.#store.setMasquerade({ kind: 'ending', state, generation })
    void this.#restoreAfterServerEnd(state, generation)
  }

  /** Reconcile an ending mode with the server; callers differ only in how they restore the real view. */
  #restoreEndingProjection(
    state: MasqueradeState,
    generation: number,
    restoreProjection: (state: MasqueradeState) => Promise<FinishProjectionResult>
  ) {
    return restoreMasqueradeProjection({
      state,
      adoptMasqueradeToken: this.#dependencies.setMasqueradeToken,
      readStatus: () => this.#dependencies.api.status(this.#store.activeCompanyId ?? undefined),
      isCurrent: () => this.#ownsRuntime(generation, 'ending'),
      publishActive: (status) =>
        this.#store.setMasquerade({
          kind: 'starting',
          pending: { companyId: status.companyId, targetUserId: status.targetUserId },
          state: status,
          generation,
        }),
      restoreProjection,
      onProjectionFailure: (message) => this.#fail(message),
    })
  }

  async #restoreAfterServerEnd(state: MasqueradeState, generation: number): Promise<void> {
    try {
      const projection = await this.#restoreEndingProjection(state, generation, async (current) =>
        (await this.#dependencies.reproject(current.companyId))
          ? { kind: 'finished' }
          : {
              kind: 'failed',
              message:
                'View as member ended, but the real account view could not be restored. Retry.',
            }
      )
      if (projection.kind === 'active') {
        await this.retryProjection()
        return
      }
      if (projection.kind !== 'restored') return
    } catch (error) {
      // A completed remote end still needs visible recovery if reloading the real company fails.
      if (!this.#ownsRuntime(generation, 'ending')) return
      console.error('The real account projection could not be restored', error)
      this.#fail('View as member ended, but the real account view could not be restored. Retry.')
      return
    }
    if (!this.#ownsRuntime(generation, 'ending')) return
    this.#releaseSuspension({ dropParkedEdits: true })
    this.#store.setMasquerade({ kind: 'inactive' })
  }
}
