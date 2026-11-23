import app from '@adonisjs/core/services/app';
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission';
import { USER_ID_PATTERN } from '#services/request_helpers';

/** Resolves the Account Kit's admission service from the container. */
export const resolveAdmission = () => app.container.make(AccountAdmission);

/** Reads an admission route's user id, or `null` when it is not an account identity id. */
export function parseUserIdParam(value: unknown) {
  return typeof value === 'string' && USER_ID_PATTERN.test(value) ? value : null;
}

/** Applies an Owner or Admin admission decision to an account. */
export async function decideAdmission(input: {
  actorId: string | number;
  userId: string;
  decision: 'approve' | 'reject' | 'revoke';
}) {
  const service = await resolveAdmission();
  const record = await service[input.decision]({ actorId: input.actorId, userId: input.userId });
  return { userId: String(record.userId), approval: record.approval };
}
