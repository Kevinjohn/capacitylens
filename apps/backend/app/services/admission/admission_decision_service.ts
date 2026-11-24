import { inject } from '@adonisjs/core';
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission';
import { USER_ID_PATTERN } from '#services/request_helpers';

/** Owner and Admin admission decisions, applied through the Account Kit. */
@inject()
export class AdmissionDecisionService {
  #admission: AccountAdmission;

  constructor(admission: AccountAdmission) {
    this.#admission = admission;
  }

  /** Reads an admission route's user id, or `null` when it is not an account identity id. */
  parseUserId(value: unknown) {
    return typeof value === 'string' && USER_ID_PATTERN.test(value) ? value : null;
  }

  /** Applies an Owner or Admin admission decision to an account. */
  async decide(input: {
    actorId: string | number;
    userId: string;
    decision: 'approve' | 'reject' | 'revoke';
  }) {
    const record = await this.#admission[input.decision]({
      actorId: input.actorId,
      userId: input.userId,
    });
    return { userId: String(record.userId), approval: record.approval };
  }
}
