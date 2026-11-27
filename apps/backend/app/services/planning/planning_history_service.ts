import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { PlanningHistoryState, PlanningIntent } from '#validators/planning/contracts'

/** The most changes one history steps back or forward through. */
export const HISTORY_LIMIT = 50

/** A committed change and the intent that reverses it. */
export interface HistoryEntry {
  forward: PlanningIntent
  inverse: PlanningIntent
}

export interface HistoryEntries {
  past: HistoryEntry[]
  future: HistoryEntry[]
}

/** The page, sign-in and person a history belongs to. */
export interface HistoryOwner {
  companyId: string
  sessionId: number
  actorId: string
  historyId: string
}

/** What a page with no current history can do. */
export const NO_HISTORY: PlanningHistoryState = { canUndo: false, canRedo: false }

const buildHistoryAvailability = (entries: HistoryEntries): PlanningHistoryState => ({
  canUndo: entries.past.length > 0,
  canRedo: entries.future.length > 0,
})

/** The caller's own undo and redo history, stored in the caller's transaction. */
export class PlanningHistoryService {
  /**
   * The owner's history when it is still current: written by this page, sign-in and person at the
   * company's present revision. Anything else is stale, because someone else's change has landed
   * or the page was reloaded.
   */
  async readHistory(
    trx: TransactionClientContract,
    owner: HistoryOwner,
    revision: number
  ): Promise<HistoryEntries | null> {
    const row = await trx.from('planning_histories').where('company_id', owner.companyId).first()
    if (
      !row ||
      row.session_id !== owner.sessionId ||
      row.actor_id !== owner.actorId ||
      row.history_id !== owner.historyId ||
      row.revision !== revision
    ) {
      return null
    }
    return JSON.parse(row.entries_json) as HistoryEntries
  }

  /** Whether the owner can undo or redo at this revision. */
  async readHistoryState(
    trx: TransactionClientContract,
    owner: HistoryOwner,
    revision: number
  ): Promise<PlanningHistoryState> {
    const entries = await this.readHistory(trx, owner, revision)
    return entries ? buildHistoryAvailability(entries) : NO_HISTORY
  }

  /** Ends the company's history; stored inverses hold earlier field values. */
  async discardHistory(trx: TransactionClientContract, companyId: string) {
    // Undo history, not a product row.
    await trx.from('planning_histories').where('company_id', companyId).delete()
  }

  /** Replaces the company's one history row with the owner's entries at the committed revision. */
  async writeHistory(
    trx: TransactionClientContract,
    owner: HistoryOwner,
    revision: number,
    entries: HistoryEntries
  ): Promise<PlanningHistoryState> {
    // Redo entries only ever come off the past, so bounding the past bounds both lists.
    const bounded = { past: entries.past.slice(-HISTORY_LIMIT), future: entries.future }
    await this.discardHistory(trx, owner.companyId)
    // Undo history, not a product row.
    await trx.table('planning_histories').insert({
      company_id: owner.companyId,
      session_id: owner.sessionId,
      actor_id: owner.actorId,
      history_id: owner.historyId,
      revision,
      entries_json: JSON.stringify(bounded),
    })
    return buildHistoryAvailability(bounded)
  }
}
