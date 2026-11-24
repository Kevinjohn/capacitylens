import { errors as vineErrors } from '@vinejs/vine';
import { test } from '@japa/runner';
import { errors as httpServerErrors, type HttpContext } from '@adonisjs/core/http';
import {
  ThrottledError,
  PostCommitError,
  accountErrorResponse,
} from '@kevinjohn/adonisjs-account-kit';
import { AdmissionRequiredError } from '@kevinjohn/adonisjs-account-kit/admission';
import PlanningController from '#controllers/planning_controller';
import HttpExceptionHandler from '#exceptions/handler';
import { MasqueradeError } from '@kevinjohn/adonisjs-masquerade';
import { IdentityAuthorizationException } from '#exceptions/identity_authorization_exception';
import {
  PlanningOperationException,
  membershipUnavailable,
} from '#exceptions/planning_operation_exception';
import { RestorationConfirmationException } from '#exceptions/restoration_confirmation_exception';
import { AccessControlError } from '@kevinjohn/adonisjs-access-control';
import { errors as limiterErrors, LimiterResponse } from '@adonisjs/limiter';
import {
  PasswordConfirmationRequiredException,
  PasswordConfirmationStaleException,
  PasswordConfirmationForbiddenException,
  PasswordConfirmationDeniedException,
  PasswordConfirmationThrottledException,
  InvalidPasswordConfirmationRequestException,
} from '@kevinjohn/adonisjs-confirm-action-with-password';
import { mapHttpError } from '#exceptions/http_error_mapping';
import { FirstCompanyPendingException } from '#exceptions/first_company_pending_exception';
import { PasswordConfirmationException } from '#exceptions/password_confirmation_exception';
import { StalePlanningRevisionException } from '#exceptions/stale_planning_revision_exception';
import {
  refuseConflictingAdmission,
  refuseInvalidAdmission,
  refuseMissingAdmission,
} from '#services/admission/errors';
import {
  credentialUpdateCommitted,
  emailInUseAnswer,
  invalidLinkAnswer,
} from '#services/auth/credential_answers';
import { signUpValidator } from '#validators/auth_requests';
import { inspectResetValidator } from '#validators/credentials';

function context(error: unknown, routeName?: string) {
  const result = { status: 0, body: undefined as unknown, headers: {} as Record<string, string> };
  const diagnostics: Array<{ fields: Record<string, unknown>; message: string }> = [];
  const response = {
    header(name: string, value: string) {
      result.headers[name] = value;
      return this;
    },
    status(status: number) {
      result.status = status;
      return this;
    },
    internalServerError(body: unknown) {
      result.status = 500;
      result.body = body;
    },
    forbidden(body: unknown) {
      result.status = 403;
      result.body = body;
    },
    badRequest(body: unknown) {
      result.status = 400;
      result.body = body;
    },
    send(body: unknown) {
      result.body = body;
    },
  };
  return {
    result,
    diagnostics,
    ctx: {
      response,
      logger: {
        error(fields: Record<string, unknown>, message: string) {
          diagnostics.push({ fields, message });
        },
      },
      request: { method: () => 'POST' },
      route: { pattern: '/api/companies/:companyId/resources', name: routeName },
      get params() {
        throw error;
      },
    } as unknown as HttpContext,
  };
}

/** Runs the planning read on a planning route; what it throws is answered by the handler. */
async function answerOnPlanning(error: unknown) {
  const planning = context(error, 'api.planning.show');
  try {
    await new PlanningController().show(planning.ctx);
  } catch (thrown) {
    await new HttpExceptionHandler().handle(thrown, planning.ctx);
  }
  return planning.result;
}

/** What the central handler answers for `error`. */
function mapped(error: unknown) {
  const outcome = mapHttpError(error);
  return outcome && { status: outcome.status, body: outcome.body };
}

/** What the handler answers for the error a call throws. */
async function mappedThrown(call: () => unknown) {
  try {
    await call();
  } catch (error) {
    return mapped(error);
  }
  throw new Error('Expected a refusal.');
}

const signUp = {
  email: 'diana.prince@themyscira.example',
  password: 'lasso-of-truth-26',
  name: 'Diana',
};

/**
 * One row per refusal sentence the backend fixes in one place, with the status and code it is
 * sent with. A sentence a call site passes in is pinned where it is thrown.
 */
const refusals: Array<[string, () => unknown, number, Record<string, unknown>]> = [
  ...(
    [
      [
        'E_MASQUERADE_CONTEXT_REQUIRED',
        428,
        'Masquerade context is required.',
        'MASQUERADE_CONTEXT_REQUIRED',
      ],
      [
        'E_MASQUERADE_CONTEXT_CHANGED',
        409,
        'Masquerade context changed.',
        'MASQUERADE_CONTEXT_CHANGED',
      ],
      ['E_MASQUERADE_ACTION_BLOCKED', 403, 'Masquerade is read-only.', 'MASQUERADE_READ_ONLY'],
      ['E_MASQUERADE_NOT_ALLOWED', 403, 'This action is not allowed.', 'AUTHORIZATION_DENIED'],
      ['E_MASQUERADE_ALREADY_ACTIVE', 409, 'Masquerade is already active.', 'MASQUERADE_ACTIVE'],
      ['E_MASQUERADE_INVALID_INPUT', 400, 'Invalid masquerade request.', 'VALIDATION_ERROR'],
      ['E_MASQUERADE_UNAUTHENTICATED', 401, 'Sign-in required.', 'SIGN_IN_REQUIRED'],
      ['E_MASQUERADE_UNAVAILABLE', 503, 'Masquerade is unavailable.', 'MASQUERADE_UNAVAILABLE'],
    ] as const
  ).map(([code, status, error, wire]): [string, () => unknown, number, Record<string, unknown>] => [
    code,
    () =>
      mapped(
        code === 'E_MASQUERADE_ACTION_BLOCKED'
          ? new MasqueradeError(code, { blockedBy: 'view_only' })
          : new MasqueradeError(code)
      ),
    status,
    { error, code: wire },
  ]),
  ...(
    [
      ['E_ACCESS_CONTROL_FORBIDDEN', 403, 'Forbidden.', 'FORBIDDEN'],
      ['E_ACCESS_CONTROL_SELF_MANAGEMENT', 403, 'Forbidden.', 'FORBIDDEN'],
      ['E_ACCESS_CONTROL_OWNER_PROTECTED', 403, 'Forbidden.', 'FORBIDDEN'],
      ['E_ACCESS_CONTROL_RANK_TOO_LOW', 403, 'Forbidden.', 'FORBIDDEN'],
      ['E_ACCESS_CONTROL_NOT_A_MEMBER', 404, 'Not a member of this company.', 'NOT_FOUND'],
      ['E_ACCESS_CONTROL_USER_NOT_FOUND', 404, 'Not found.', 'NOT_FOUND'],
      ['E_ACCESS_CONTROL_SCOPE_NOT_FOUND', 404, 'Company not found.', 'NOT_FOUND'],
      ['E_ACCESS_CONTROL_ALREADY_MEMBER', 409, 'Already a member of this company.', 'CONFLICT'],
      ['E_ACCESS_CONTROL_LAST_OWNER', 409, 'Transfer ownership first.', 'LAST_OWNER'],
      ['E_ACCESS_CONTROL_CONFLICT', 409, 'The company changed. Try again.', 'CONFLICT'],
    ] as const
  ).map(([code, status, error, wire]): [string, () => unknown, number, Record<string, unknown>] => [
    code,
    () => mapped(new AccessControlError(code)),
    status,
    { error, code: wire },
  ]),
  ...[
    PasswordConfirmationRequiredException,
    PasswordConfirmationStaleException,
    PasswordConfirmationForbiddenException,
  ].map((Refusal): [string, () => unknown, number, Record<string, unknown>] => [
    Refusal.name,
    () => mapped(new Refusal()),
    403,
    { error: 'Confirm this action again.', code: 'PASSWORD_CONFIRMATION_REQUIRED' },
  ]),
  [
    'PasswordConfirmationDeniedException',
    () => mapped(new PasswordConfirmationDeniedException()),
    403,
    { error: 'Incorrect password.', code: 'PASSWORD_CONFIRMATION_DENIED' },
  ],
  [
    'PasswordConfirmationThrottledException',
    () => mapped(new PasswordConfirmationThrottledException(90)),
    429,
    { error: 'Too many attempts. Try again in 2 minutes.' },
  ],
  [
    'InvalidPasswordConfirmationRequestException',
    () => mapped(new InvalidPasswordConfirmationRequestException('SENTINEL_REASON')),
    400,
    { error: 'Invalid password confirmation.' },
  ],
  [
    'PasswordConfirmationException',
    () => mapped(new PasswordConfirmationException()),
    403,
    { error: 'Confirm this action again.', code: 'PASSWORD_CONFIRMATION_REQUIRED' },
  ],
  [
    'FirstCompanyPendingException',
    () => mapped(new FirstCompanyPendingException()),
    409,
    {
      error: 'Only the invited first Owner may join before the company exists.',
      code: 'FIRST_COMPANY_PENDING',
    },
  ],
  [
    'refuseInvalidAdmission',
    () => mappedThrown(() => refuseInvalidAdmission()),
    400,
    { error: 'Invalid admission request.', code: 'VALIDATION_ERROR' },
  ],
  [
    'refuseMissingAdmission',
    () => mappedThrown(() => refuseMissingAdmission()),
    404,
    { error: 'Invitation not found.', code: 'NOT_FOUND' },
  ],
  [
    'refuseConflictingAdmission',
    () => mappedThrown(() => refuseConflictingAdmission()),
    409,
    { error: 'Invitation has already been used.', code: 'CONFLICT' },
  ],
  [
    'membershipUnavailable',
    () => mapped(membershipUnavailable()),
    403,
    { error: 'Company membership is unavailable.', code: 'ACCOUNT_MEMBERSHIP_LOST' },
  ],
  [
    'StalePlanningRevisionException',
    () => mapped(new StalePlanningRevisionException('mutation', 1, 2)),
    409,
    {
      error: 'The planning revision changed before this mutation was applied.',
      code: 'STALE_REVISION',
    },
  ],
  [
    'unsupported field',
    () => mappedThrown(() => signUpValidator.validate({ ...signUp, role: 'owner' })),
    400,
    { error: 'Unsupported field.', code: 'VALIDATION_ERROR' },
  ],
  [
    'invalid email',
    () => mappedThrown(() => signUpValidator.validate({ ...signUp, email: 'diana' })),
    400,
    { error: 'Invalid email.', code: 'VALIDATION_ERROR' },
  ],
  [
    'invalid name',
    () => mappedThrown(() => signUpValidator.validate({ ...signUp, name: ' ' })),
    400,
    { error: 'Invalid name.', code: 'VALIDATION_ERROR' },
  ],
  [
    'invalid password',
    () => mappedThrown(() => signUpValidator.validate({ ...signUp, password: 'short' })),
    400,
    { error: 'Invalid password.', code: 'VALIDATION_ERROR' },
  ],
  [
    'invalid token',
    () => mappedThrown(() => inspectResetValidator.validate({ token: 'x'.repeat(513) })),
    400,
    { error: 'Invalid token.', code: 'VALIDATION_ERROR' },
  ],
  // The controllers that spend a link, create an account or change a password send these bodies.
  [
    'invalid or expired link',
    () => ({ status: 400, body: invalidLinkAnswer }),
    400,
    {
      error: 'This link is invalid or expired.',
      code: 'INVALID_TOKEN',
    },
  ],
  [
    'email in use',
    () => ({ status: 409, body: emailInUseAnswer }),
    409,
    {
      error: 'An account already uses this email. Sign in or reset your password.',
      code: 'EMAIL_IN_USE',
    },
  ],
  [
    'committed password change',
    () => ({ status: 503, body: credentialUpdateCommitted }),
    503,
    {
      error:
        'Your password was changed, but a follow-up step failed. Sign in with the new password.',
      code: 'CREDENTIAL_UPDATE_COMMITTED',
      committed: true,
    },
  ],
  [
    'unsupported content encoding',
    () => mapped(Object.assign(new Error('Unsupported Content-Encoding: br'), { status: 415 })),
    415,
    { error: 'Unsupported media type.', code: 'UNSUPPORTED_MEDIA_TYPE' },
  ],
  [
    'invalid JSON',
    () => mapped(Object.assign(new SyntaxError('Unexpected end'), { status: 400, body: '{' })),
    400,
    { error: 'Request body must be valid JSON.', code: 'INVALID_JSON' },
  ],
  [
    'JSON that is not an object or array',
    () =>
      mapped(
        Object.assign(new Error('Invalid JSON, only supports object and array'), { status: 422 })
      ),
    400,
    { error: 'Request JSON must be an object or array.', code: 'INVALID_JSON_SHAPE' },
  ],
  [
    'E_ROUTE_NOT_FOUND',
    () => mapped(new httpServerErrors.E_ROUTE_NOT_FOUND(['GET', '/missing'])),
    404,
    { error: 'Not found.', code: 'NOT_FOUND' },
  ],
  [
    'E_REQUEST_ENTITY_TOO_LARGE',
    () => mapped(Object.assign(new Error('too large'), { code: 'E_REQUEST_ENTITY_TOO_LARGE' })),
    413,
    { error: 'Request body is too large.', code: 'PAYLOAD_TOO_LARGE' },
  ],
  [
    'E_ENCODING_UNSUPPORTED',
    () => mapped(Object.assign(new Error('encoding'), { code: 'E_ENCODING_UNSUPPORTED' })),
    415,
    { error: 'Unsupported media type.', code: 'UNSUPPORTED_MEDIA_TYPE' },
  ],
  [
    'database constraint',
    () => mapped(Object.assign(new Error('constraint'), { code: 'SQLITE_CONSTRAINT_UNIQUE' })),
    400,
    {
      error: 'That change references missing data or conflicts with an existing record.',
      code: 'VALIDATION_ERROR',
    },
  ],
  [
    'E_TOO_MANY_REQUESTS',
    () =>
      mapped(
        new limiterErrors.E_TOO_MANY_REQUESTS(
          new LimiterResponse({ limit: 1, remaining: 0, consumed: 2, availableIn: 30 })
        )
      ),
    429,
    { error: 'Rate limit exceeded.' },
  ],
];

test.group('product error adapters', () => {
  for (const adapter of ['global', 'planning'] as const) {
    test(`${adapter} preserves kit codes, status, headers and committed metadata`, async ({
      assert,
    }) => {
      for (const error of [new ThrottledError(37), new PostCommitError()]) {
        const { ctx, result } = context(error);
        if (adapter === 'global') await new HttpExceptionHandler().handle(error, ctx);
        else Object.assign(result, await answerOnPlanning(error));
        const expected = accountErrorResponse(error)!;
        const [kitError] = expected.body.errors;
        assert.equal(result.status, expected.status);
        assert.deepEqual(result.headers, expected.headers);
        assert.deepEqual(result.body, {
          error: kitError!.message,
          code: kitError!.code,
          ...(kitError!.committed ? { committed: true } : {}),
        });
      }
    });
    test(`${adapter} preserves admission decisions`, async ({ assert }) => {
      const decision = { admitted: false, requirements: { invitation: { met: false } } };
      const error = new AdmissionRequiredError(decision);
      const { ctx, result } = context(error);
      if (adapter === 'global') await new HttpExceptionHandler().handle(error, ctx);
      else Object.assign(result, await answerOnPlanning(error));
      assert.equal(result.status, 403);
      assert.properties(result.body as object, ['error', 'code', 'decision']);
      assert.deepEqual((result.body as { decision: unknown }).decision, decision);
      assert.equal((result.body as { code: string }).code, 'ADMISSION_REQUIRED');
    });
  }
  const routeNames = [
    'api.companies.index',
    'api.planning.show',
    'api.member_resource_links.update',
    'api.company_exports.show',
  ];
  /** Answers `error` on every route name and returns the one status and body they share. */
  async function answerOnEveryRoute(error: () => unknown) {
    const answers = [];
    for (const name of routeNames) {
      const thrown = error();
      const { ctx, result } = context(thrown, name);
      await new HttpExceptionHandler().handle(thrown, ctx);
      answers.push({ status: result.status, body: result.body });
    }
    return answers;
  }
  test('IdentityAuthorizationException answers 403 with its own message and code on every route', async ({
    assert,
  }) => {
    for (const answer of await answerOnEveryRoute(
      () => new IdentityAuthorizationException('Invalid membership role.')
    )) {
      assert.deepEqual(answer, {
        status: 403,
        body: { error: 'Invalid membership role.', code: 'IDENTITY_AUTHORIZATION_DENIED' },
      });
    }
  });
  test('AdmissionRequiredError answers 403 with one sentence and the decision on every route', async ({
    assert,
  }) => {
    const decision = { admitted: false, requirements: { invitation: { met: false } } };
    for (const answer of await answerOnEveryRoute(() => new AdmissionRequiredError(decision))) {
      assert.deepEqual(answer, {
        status: 403,
        body: {
          error: 'Your access to this company is waiting on admission.',
          code: 'ADMISSION_REQUIRED',
          decision,
        },
      });
    }
  });
  test('a Vine failure without a message answers 400 with one sentence on every route', async ({
    assert,
  }) => {
    for (const answer of await answerOnEveryRoute(() => new vineErrors.E_VALIDATION_ERROR([]))) {
      assert.deepEqual(answer, {
        status: 400,
        body: { error: 'Invalid request.', code: 'VALIDATION_ERROR' },
      });
    }
  });
  test('reporting skips every refusal the handler maps below 500', async ({ assert }) => {
    for (const error of [
      new MasqueradeError('E_MASQUERADE_CONTEXT_CHANGED'),
      new MasqueradeError('E_MASQUERADE_NOT_ALLOWED'),
      new AdmissionRequiredError({ admitted: false, requirements: { invitation: { met: false } } }),
      new IdentityAuthorizationException('Invalid membership role.'),
      new httpServerErrors.E_ROUTE_NOT_FOUND(['GET', '/missing']),
    ]) {
      const { ctx, diagnostics } = context(error);
      await new HttpExceptionHandler().report(error, ctx);
      assert.lengthOf(diagnostics, 0, String((error as { code?: string }).code));
    }
    const unexpected = context(new Error('SENTINEL'));
    await new HttpExceptionHandler().report(new Error('SENTINEL'), unexpected.ctx);
    assert.lengthOf(unexpected.diagnostics, 1);
    assert.include(unexpected.diagnostics[0]!.fields, { errorType: 'unexpected', status: 500 });
  });
  test('constraint refusals carry the validation code', async ({ assert }) => {
    const error = Object.assign(new Error('SENTINEL_SQL_TEXT SENTINEL_PAYLOAD'), {
      code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
      sql: 'SENTINEL_SQL_TEXT',
      payload: 'SENTINEL_PAYLOAD',
    });
    const { ctx, result, diagnostics } = context(error);
    await new HttpExceptionHandler().handle(error, ctx);
    await new HttpExceptionHandler().report(error, ctx);
    assert.equal(result.status, 400);
    assert.equal((result.body as { code: string }).code, 'VALIDATION_ERROR');
    assert.lengthOf(diagnostics, 1);
    assert.deepEqual(diagnostics[0]!.fields, {
      event: 'http.request.error',
      errorType: 'database_constraint',
      method: 'POST',
      path: '/api/companies/:companyId/resources',
      status: 400,
    });
    const serialized = JSON.stringify(diagnostics);
    assert.notInclude(serialized, 'SENTINEL_SQL_TEXT');
    assert.notInclude(serialized, 'SENTINEL_PAYLOAD');
    assert.notInclude(serialized, error.message);
  });
  test('Vine validation is flat status 400 rather than the generated default 422', async ({
    assert,
  }) => {
    const error = new vineErrors.E_VALIDATION_ERROR([
      { message: 'Email is required.', field: 'email', rule: 'required' },
    ]);
    const { ctx, result } = context(error);
    await new HttpExceptionHandler().handle(error, ctx);
    assert.equal(result.status, 400);
    assert.deepEqual(result.body, { error: 'Email is required.', code: 'VALIDATION_ERROR' });
  });
  test('planning operation refusals send the status and code the service states', async ({
    assert,
  }) => {
    const conflict = await answerOnPlanning(
      new PlanningOperationException(409, null, 'The record is in use.')
    );
    assert.equal(conflict.status, 409);
    assert.deepEqual(conflict.body, { error: 'The record is in use.' });

    // No code is inferred from the status, and a stated code does not rewrite the status.
    const uncoded = await answerOnPlanning(
      new PlanningOperationException(400, null, 'Nothing to restore.')
    );
    assert.equal(uncoded.status, 400);
    assert.deepEqual(uncoded.body, { error: 'Nothing to restore.' });

    const stale = await answerOnPlanning(
      new PlanningOperationException(409, 'STALE_REVISION', 'Reload first.')
    );
    assert.equal(stale.status, 409);
    assert.deepEqual(stale.body, { error: 'Reload first.', code: 'STALE_REVISION' });
  });
  test('planning restoration failures retain both typed count-bearing variants', async ({
    assert,
  }) => {
    for (const stale of [false, true]) {
      const error = new RestorationConfirmationException(3, stale);
      const result = await answerOnPlanning(error);
      assert.equal(result.status, 409);
      assert.deepEqual(result.body, {
        error: error.message,
        code: stale ? 'RESTORATION_CONFIRMATION_STALE' : 'RESTORATION_CONFIRMATION_REQUIRED',
        restorableItemCount: 3,
      });
    }
  });
  test('each fixed refusal sentence is sent with one status and code', async ({ assert }) => {
    for (const [name, produce, status, body] of refusals) {
      assert.deepEqual(await produce(), { status, body }, name);
    }
  });
});
