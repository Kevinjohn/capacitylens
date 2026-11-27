import type { HttpErrorBody } from '@capacitylens/shared/api/httpErrors'
import { errors } from '@kevinjohn/adonisjs-access-control'

// Unlisted exceptions (UNKNOWN_ROLE, INVALID_CONFIG, OWNER_DISABLED, SCOPE_NOT_EMPTY, INVALID_INPUT)
// are server faults. Product callers validate roles, statuses and targets before calling the
// package, so INVALID_INPUT only reports a programming fault.
const refusals: ReadonlyArray<
  readonly [new (...args: never[]) => Error, { status: number; code: string; error: string }]
> = [
  [errors.E_ACCESS_CONTROL_FORBIDDEN, { status: 403, code: 'FORBIDDEN', error: 'Forbidden.' }],
  [
    errors.E_ACCESS_CONTROL_SELF_MANAGEMENT,
    { status: 403, code: 'FORBIDDEN', error: 'Forbidden.' },
  ],
  [
    errors.E_ACCESS_CONTROL_OWNER_PROTECTED,
    { status: 403, code: 'FORBIDDEN', error: 'Forbidden.' },
  ],
  [errors.E_ACCESS_CONTROL_RANK_TOO_LOW, { status: 403, code: 'FORBIDDEN', error: 'Forbidden.' }],
  [
    errors.E_ACCESS_CONTROL_NOT_A_MEMBER,
    { status: 404, code: 'NOT_FOUND', error: 'Not a member of this company.' },
  ],
  [errors.E_ACCESS_CONTROL_USER_NOT_FOUND, { status: 404, code: 'NOT_FOUND', error: 'Not found.' }],
  [
    errors.E_ACCESS_CONTROL_SCOPE_NOT_FOUND,
    { status: 404, code: 'NOT_FOUND', error: 'Company not found.' },
  ],
  [
    errors.E_ACCESS_CONTROL_ALREADY_MEMBER,
    { status: 409, code: 'CONFLICT', error: 'Already a member of this company.' },
  ],
  [
    errors.E_ACCESS_CONTROL_LAST_OWNER,
    { status: 409, code: 'LAST_OWNER', error: 'Transfer ownership first.' },
  ],
  [
    errors.E_ACCESS_CONTROL_CONFLICT,
    { status: 409, code: 'CONFLICT', error: 'The company changed. Try again.' },
  ],
]

/** Maps a recognised package exception to its product refusal; returns undefined for anything else, which is a server fault. */
export function buildAccessRefusal(
  error: unknown
): { status: number; body: HttpErrorBody } | undefined {
  const mapped = refusals.find(([exception]) => error instanceof exception)?.[1]
  return mapped
    ? { status: mapped.status, body: { error: mapped.error, code: mapped.code } }
    : undefined
}
