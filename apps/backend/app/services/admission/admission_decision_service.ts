import { inject } from '@adonisjs/core'
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission'

/** Owner and Admin admission decisions, applied through the Account Kit. */
@inject()
export class AdmissionDecisionService {
  #admission: AccountAdmission

  constructor(admission: AccountAdmission) {
    this.#admission = admission
  }

  /** Applies an Owner or Admin admission decision to an account. */
  async decide(input: {
    actorId: string | number
    userId: string
    decision: 'approve' | 'reject' | 'revoke'
  }) {
    const record = await this.#admission[input.decision]({
      actorId: input.actorId,
      userId: input.userId,
    })
    return { userId: String(record.userId), approval: record.approval }
  }
}
