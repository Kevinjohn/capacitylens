import { errors as vineErrors } from '@vinejs/vine';
import { test } from '@japa/runner';
import { errors as httpServerErrors, type HttpContext } from '@adonisjs/core/http';
import {
  E_ACCOUNT_KIT_THROTTLED,
  E_ACCOUNT_KIT_POST_COMMIT,
  accountErrorResponse,
} from '@kevinjohn/adonisjs-account-kit';
import { E_ACCOUNT_KIT_ADMISSION_REQUIRED } from '@kevinjohn/adonisjs-account-kit/admission';
import app from '@adonisjs/core/services/app';
import PlanningController from '#controllers/planning_controller';
import HttpExceptionHandler from '#exceptions/handler';
import { errors as masqueradeErrors } from '@kevinjohn/adonisjs-masquerade';
import { IdentityAuthorizationException } from '#exceptions/identity_authorization_exception';
import { errors as accessControlErrors } from '@kevinjohn/adonisjs-access-control';
import { errors as limiterErrors, LimiterResponse } from '@adonisjs/limiter';
import {
  PasswordConfirmationRequiredException,
  PasswordConfirmationStaleException,
  PasswordConfirmationForbiddenException,
  PasswordConfirmationDeniedException,
  PasswordConfirmationThrottledException,
  InvalidPasswordConfirmationRequestException,
} from '@kevinjohn/adonisjs-confirm-action-with-password';
import { FirstCompanyPendingException } from '#exceptions/first_company_pending_exception';
import { PasswordConfirmationException } from '#exceptions/password_confirmation_exception';
import { StalePlanningRevisionException } from '#exceptions/stale_planning_revision_exception';
import {
  refuseConflictingAdmission,
  refuseInvalidAdmission,
  refuseMissingAdmission,
} from '#exceptions/admission_errors';
import {
  credentialUpdateCommitted,
  emailInUseAnswer,
  invalidLinkAnswer,
} from '#exceptions/credential_answers';
import { signUpValidator } from '#validators/auth_requests';
import {
  acceptInvitationSignUpValidator,
  createInvitationValidator,
} from '#validators/invitations';
import { inspectResetValidator } from '#validators/credentials';
import loggerConfig from '#config/logger';
import {
  MembershipLostException,
  MutationIdReusedException,
  NoChangeException,
  PlanningAuthorizationException,
  RecordChangedException,
  PlanningConflictException,
} from '#exceptions/planning_operation_exception';
import { EmptyHistoryException } from '#exceptions/empty_history_exception';
import {
  ActivityPhaseProjectMismatchException,
  EntityDomainRuleException,
  EntityNotFoundException,
  EntityWriteException,
  ExampleDataCompanyNotEmptyException,
  FrozenCompanyFieldException,
  ImportIdCollisionException,
  ImportSnapshotStaleException,
  ResourceAvatarUrlForbiddenException,
  ResourceAvatarUrlInvalidException,
  ResourceKindImmutableException,
} from '#exceptions/entity_write_exception';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '#exceptions/refusal_exception';
import {
  CompanySetupRequiredException,
  MultipleCompaniesException,
} from '#exceptions/admission_exception';
import { OwnerTransferRequiredException } from '#exceptions/membership_exception';
import { IdempotencyConflictException } from '#exceptions/account_operation_exception';
import { DomainError } from '@capacitylens/shared/domain/errors';
import {
  RestorationConfirmationRequiredException,
  RestorationConfirmationStaleException,
} from '#exceptions/restoration_confirmation_exception';

/** The `err` field as the logger writes it. */
const serializeErr = (error: unknown) => loggerConfig.loggers.app.serializers!.err!(error);

function context(error: unknown, routeName?: string) {
  const result = { status: 0, body: undefined as unknown, headers: {} as Record<string, string> };
  const diagnostics: Array<{ level: string; fields: Record<string, unknown>; message: string }> =
    [];
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
        log(level: string, fields: Record<string, unknown>, message: string) {
          diagnostics.push({ level, fields, message });
        },
      },
      request: { method: () => 'POST', id: () => undefined, accepts: () => 'json' },
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
    const controller = await app.container.make(PlanningController);
    await controller.show(planning.ctx);
  } catch (thrown) {
    await new HttpExceptionHandler().handle(thrown, planning.ctx);
  }
  return planning.result;
}

/** What the exception handler answers for `error`. */
async function answered(error: unknown) {
  const { ctx, result } = context(error);
  await new HttpExceptionHandler().handle(error, ctx);
  return { status: result.status, body: result.body };
}

/** What the handler answers for the error a call throws. */
async function answeredThrown(call: () => unknown) {
  try {
    await call();
  } catch (error) {
    return answered(error);
  }
  throw new Error('Expected a refusal.');
}

/**
 * The framework's answer to a route validator's failure, kept to the status and the first error's
 * message: the sentence the validator fixes.
 */
async function routeValidationAnswer(call: () => unknown) {
  const { status, body } = await answeredThrown(call);
  const [first] = (body as { errors: Array<{ message: string }> }).errors;
  return { status, body: { errors: [{ message: first?.message }] } };
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
      ['E_MASQUERADE_UNAUTHENTICATED', 401, 'Sign-in required.', 'SIGN_IN_REQUIRED'],
      ['E_MASQUERADE_UNAVAILABLE', 503, 'Masquerade is unavailable.', 'MASQUERADE_UNAVAILABLE'],
    ] as const
  ).map(([code, status, error, wire]): [string, () => unknown, number, Record<string, unknown>] => [
    code,
    () =>
      answered(
        code === 'E_MASQUERADE_ACTION_BLOCKED'
          ? new masqueradeErrors.E_MASQUERADE_ACTION_BLOCKED('view_only')
          : new masqueradeErrors[code]()
      ),
    status,
    { error, code: wire },
  ]),
  [
    'E_MASQUERADE_INVALID_INPUT',
    () => answered(new masqueradeErrors.E_MASQUERADE_INVALID_INPUT()),
    422,
    { errors: [{ message: 'Invalid masquerade request.' }] },
  ],
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
    () => answered(new accessControlErrors[code]()),
    status,
    { error, code: wire },
  ]),
  ...[
    PasswordConfirmationRequiredException,
    PasswordConfirmationStaleException,
    PasswordConfirmationForbiddenException,
  ].map((Refusal): [string, () => unknown, number, Record<string, unknown>] => [
    Refusal.name,
    () => answered(new Refusal()),
    403,
    { error: 'Confirm this action again.', code: 'PASSWORD_CONFIRMATION_REQUIRED' },
  ]),
  [
    'PasswordConfirmationDeniedException',
    () => answered(new PasswordConfirmationDeniedException()),
    403,
    { error: 'Incorrect password.', code: 'PASSWORD_CONFIRMATION_DENIED' },
  ],
  [
    'PasswordConfirmationThrottledException',
    () => answered(new PasswordConfirmationThrottledException(90)),
    429,
    { error: 'Too many attempts. Try again in 2 minutes.' },
  ],
  [
    'InvalidPasswordConfirmationRequestException',
    () => answered(new InvalidPasswordConfirmationRequestException('SENTINEL_REASON')),
    400,
    { error: 'Invalid password confirmation.' },
  ],
  [
    'PasswordConfirmationException',
    () => answered(new PasswordConfirmationException()),
    403,
    { error: 'Confirm this action again.', code: 'PASSWORD_CONFIRMATION_REQUIRED' },
  ],
  [
    'FirstCompanyPendingException',
    () => answered(new FirstCompanyPendingException()),
    409,
    {
      error: 'Only the invited first Owner may join before the company exists.',
      code: 'FIRST_COMPANY_PENDING',
    },
  ],
  [
    'PlanningAuthorizationException',
    () => answered(new PlanningAuthorizationException()),
    403,
    { error: 'This action is not allowed.', code: 'AUTHORIZATION_DENIED' },
  ],
  [
    'RecordChangedException',
    () => answered(new RecordChangedException()),
    409,
    { error: 'The record changed since it was opened.', code: 'STALE_REVISION' },
  ],
  [
    'MutationIdReusedException',
    () => answered(new MutationIdReusedException()),
    409,
    { error: 'This mutation identity has already committed.', code: 'MUTATION_ID_REUSED' },
  ],
  [
    'NoChangeException',
    () => answered(new NoChangeException('No change.')),
    400,
    { error: 'No change.', code: 'NO_CHANGE' },
  ],
  [
    'PlanningConflictException',
    () => answered(new PlanningConflictException('In use.')),
    409,
    { error: 'In use.' },
  ],
  [
    'EmptyHistoryException',
    () => answered(new EmptyHistoryException('Nothing to undo.')),
    409,
    { error: 'Nothing to undo.' },
  ],
  [
    'EntityWriteException',
    () => answered(new EntityWriteException('Name is required.')),
    400,
    { error: 'Name is required.' },
  ],
  [
    'EntityNotFoundException',
    () => answered(new EntityNotFoundException('Not found.')),
    404,
    { error: 'Not found.' },
  ],
  [
    'FrozenCompanyFieldException',
    () => answered(new FrozenCompanyFieldException()),
    409,
    {
      error:
        'Language, week start and time zone are set when the company is created and cannot be changed.',
    },
  ],
  [
    'ImportIdCollisionException',
    () => answered(new ImportIdCollisionException()),
    409,
    {
      error: 'The import contains scheduling IDs used by another company on this server.',
      code: 'IMPORT_ID_COLLISION',
    },
  ],
  [
    'ImportSnapshotStaleException',
    () => answered(new ImportSnapshotStaleException(7)),
    409,
    {
      error: 'The company changed. Preview the current data again.',
      code: 'IMPORT_SNAPSHOT_STALE',
      revision: 7,
    },
  ],
  [
    'ExampleDataCompanyNotEmptyException',
    () => answered(new ExampleDataCompanyNotEmptyException()),
    409,
    {
      error:
        'Example data can only be added to a company that has no people, clients, projects or allocations, including archived or deleted ones.',
      code: 'EXAMPLE_DATA_COMPANY_NOT_EMPTY',
    },
  ],
  [
    'ResourceAvatarUrlForbiddenException',
    () => answered(new ResourceAvatarUrlForbiddenException()),
    400,
    { error: 'Only a person can have an avatar URL.', code: 'resource_avatar_url_forbidden' },
  ],
  [
    'ResourceAvatarUrlInvalidException',
    () => answered(new ResourceAvatarUrlInvalidException('Bad URL.')),
    400,
    { error: 'Bad URL.', code: 'resource_avatar_url_invalid' },
  ],
  [
    'ResourceKindImmutableException',
    () => answered(new ResourceKindImmutableException('Kind is fixed.')),
    400,
    { error: 'Kind is fixed.', code: 'resource_kind_immutable' },
  ],
  [
    'ActivityPhaseProjectMismatchException',
    () => answered(new ActivityPhaseProjectMismatchException()),
    400,
    {
      error: 'A phase with activities cannot move to a different project.',
      code: 'activity_phase_project_mismatch',
    },
  ],
  [
    'EntityDomainRuleException',
    () =>
      answered(
        new EntityDomainRuleException(new DomainError('record_wrong_company', 'Wrong company.'))
      ),
    400,
    { error: 'Wrong company.', code: 'record_wrong_company' },
  ],
  [
    'NotFoundException',
    () => answered(new NotFoundException('Member not found.')),
    404,
    { error: 'Member not found.', code: 'NOT_FOUND' },
  ],
  [
    'ConflictException',
    () => answered(new ConflictException('Already used.')),
    409,
    { error: 'Already used.', code: 'CONFLICT' },
  ],
  [
    'ForbiddenException',
    () => answered(new ForbiddenException()),
    403,
    { error: 'Forbidden.', code: 'FORBIDDEN' },
  ],
  [
    'MultipleCompaniesException',
    () => answered(new MultipleCompaniesException()),
    409,
    {
      error:
        'This installation has more than one company. Accounts need a single-company database.',
      code: 'MULTIPLE_COMPANIES',
    },
  ],
  [
    'CompanySetupRequiredException',
    () => answered(new CompanySetupRequiredException()),
    409,
    { error: 'The company has not been set up yet.', code: 'COMPANY_SETUP_REQUIRED' },
  ],
  [
    'OwnerTransferRequiredException',
    () => answered(new OwnerTransferRequiredException()),
    400,
    { error: 'Transfer ownership to assign the Owner role.', code: 'OWNER_TRANSFER_REQUIRED' },
  ],
  [
    'IdempotencyConflictException',
    () => answered(new IdempotencyConflictException()),
    409,
    { error: 'Operation id already used.', code: 'IDEMPOTENCY_CONFLICT' },
  ],
  [
    'IdentityAuthorizationException',
    () => answered(new IdentityAuthorizationException()),
    403,
    { error: 'Forbidden.', code: 'IDENTITY_AUTHORIZATION_DENIED' },
  ],
  [
    'refuseInvalidAdmission',
    () => answeredThrown(() => refuseInvalidAdmission()),
    422,
    { errors: [{ message: 'Invalid admission request.' }] },
  ],
  [
    'refuseMissingAdmission',
    () => answeredThrown(() => refuseMissingAdmission()),
    404,
    { error: 'Invitation not found.', code: 'NOT_FOUND' },
  ],
  [
    'refuseConflictingAdmission',
    () => answeredThrown(() => refuseConflictingAdmission()),
    409,
    { error: 'Invitation has already been used.', code: 'CONFLICT' },
  ],
  [
    'MembershipLostException',
    () => answered(new MembershipLostException()),
    403,
    { error: 'Company membership is unavailable.', code: 'ACCOUNT_MEMBERSHIP_LOST' },
  ],
  [
    'StalePlanningRevisionException',
    () => answered(new StalePlanningRevisionException('mutation', 1, 2)),
    409,
    {
      error: 'The planning revision changed before this mutation was applied.',
      code: 'STALE_REVISION',
    },
  ],
  [
    'unsupported field',
    () => routeValidationAnswer(() => signUpValidator.validate({ ...signUp, role: 'owner' })),
    422,
    { errors: [{ message: 'Unsupported field.' }] },
  ],
  [
    'invalid email',
    () => routeValidationAnswer(() => signUpValidator.validate({ ...signUp, email: 'diana' })),
    422,
    { errors: [{ message: 'Invalid email.' }] },
  ],
  [
    'invalid name',
    () => routeValidationAnswer(() => signUpValidator.validate({ ...signUp, name: ' ' })),
    422,
    { errors: [{ message: 'Invalid name.' }] },
  ],
  [
    'invalid password',
    () => routeValidationAnswer(() => signUpValidator.validate({ ...signUp, password: 'short' })),
    422,
    { errors: [{ message: 'Invalid password.' }] },
  ],
  // Invitation sign-up and invitation creation read the same sentences as sign-up.
  [
    'invitation sign-up with a short password',
    () =>
      routeValidationAnswer(() =>
        acceptInvitationSignUpValidator.validate({ name: 'Diana Prince', password: 'short' })
      ),
    422,
    { errors: [{ message: 'Invalid password.' }] },
  ],
  [
    'invitation sign-up with an unsupported field',
    () =>
      routeValidationAnswer(() =>
        acceptInvitationSignUpValidator.validate({
          name: 'Diana Prince',
          password: signUp.password,
          role: 'owner',
        })
      ),
    422,
    { errors: [{ message: 'Unsupported field.' }] },
  ],
  [
    'invitation with an invalid email',
    () =>
      routeValidationAnswer(() =>
        createInvitationValidator.validate({ companyId: 'c', role: 'editor', email: 'diana' })
      ),
    422,
    { errors: [{ message: 'Invalid email.' }] },
  ],
  [
    'invalid token',
    () => routeValidationAnswer(() => inspectResetValidator.validate({ token: 'x'.repeat(513) })),
    422,
    { errors: [{ message: 'Invalid token.' }] },
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
    () => answered(Object.assign(new Error('Unsupported Content-Encoding: br'), { status: 415 })),
    415,
    { error: 'Unsupported media type.', code: 'UNSUPPORTED_MEDIA_TYPE' },
  ],
  [
    'invalid JSON',
    () => answered(Object.assign(new SyntaxError('Unexpected end'), { status: 400, body: '{' })),
    400,
    { error: 'Request body must be valid JSON.', code: 'INVALID_JSON' },
  ],
  [
    'JSON that is not an object or array',
    () =>
      answered(
        Object.assign(new Error('Invalid JSON, only supports object and array'), { status: 422 })
      ),
    400,
    { error: 'Request JSON must be an object or array.', code: 'INVALID_JSON_SHAPE' },
  ],
  [
    'E_ROUTE_NOT_FOUND',
    () => answered(new httpServerErrors.E_ROUTE_NOT_FOUND(['GET', '/missing'])),
    404,
    { error: 'Not found.', code: 'NOT_FOUND' },
  ],
  [
    'E_REQUEST_ENTITY_TOO_LARGE',
    () => answered(Object.assign(new Error('too large'), { code: 'E_REQUEST_ENTITY_TOO_LARGE' })),
    413,
    { error: 'Request body is too large.', code: 'PAYLOAD_TOO_LARGE' },
  ],
  [
    'E_ENCODING_UNSUPPORTED',
    () => answered(Object.assign(new Error('encoding'), { code: 'E_ENCODING_UNSUPPORTED' })),
    415,
    { error: 'Unsupported media type.', code: 'UNSUPPORTED_MEDIA_TYPE' },
  ],
  [
    'database constraint',
    () => answered(Object.assign(new Error('constraint'), { code: 'SQLITE_CONSTRAINT_UNIQUE' })),
    500,
    { error: 'Internal server error.' },
  ],
  [
    'E_TOO_MANY_REQUESTS',
    () =>
      answered(
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
      for (const error of [new E_ACCOUNT_KIT_THROTTLED(37), new E_ACCOUNT_KIT_POST_COMMIT()]) {
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
      const error = new E_ACCOUNT_KIT_ADMISSION_REQUIRED(decision);
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
  test('E_ACCOUNT_KIT_ADMISSION_REQUIRED answers 403 with one sentence and the decision on every route', async ({
    assert,
  }) => {
    const decision = { admitted: false, requirements: { invitation: { met: false } } };
    for (const answer of await answerOnEveryRoute(
      () => new E_ACCOUNT_KIT_ADMISSION_REQUIRED(decision)
    )) {
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
  test('a Vine failure without a message takes the framework answer on every route', async ({
    assert,
  }) => {
    for (const answer of await answerOnEveryRoute(() => new vineErrors.E_VALIDATION_ERROR([]))) {
      assert.deepEqual(answer, { status: 422, body: { errors: [] } });
    }
  });
  test('reporting skips every refusal the handler maps below 500', async ({ assert }) => {
    for (const error of [
      new masqueradeErrors.E_MASQUERADE_CONTEXT_CHANGED(),
      new masqueradeErrors.E_MASQUERADE_NOT_ALLOWED(),
      new E_ACCOUNT_KIT_ADMISSION_REQUIRED({
        admitted: false,
        requirements: { invitation: { met: false } },
      }),
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
    assert.include(serializeErr(unexpected.diagnostics[0]!.fields.err), {
      errorType: 'unexpected',
      status: 500,
    });
  });
  test('a constraint failure is a server fault: 500 answered and logged', async ({ assert }) => {
    const error = Object.assign(new Error('SENTINEL_SQL_TEXT SENTINEL_PAYLOAD'), {
      code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
      sql: 'SENTINEL_SQL_TEXT',
      payload: 'SENTINEL_PAYLOAD',
    });
    const { ctx, result, diagnostics } = context(error);
    await new HttpExceptionHandler().handle(error, ctx);
    await new HttpExceptionHandler().report(error, ctx);
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { error: 'Internal server error.' });
    assert.lengthOf(diagnostics, 1);
    const { err, ...fields } = diagnostics[0]!.fields;
    assert.deepEqual(fields, {
      event: 'http.request.error',
      method: 'POST',
      path: '/api/companies/:companyId/resources',
    });
    assert.include(serializeErr(err), { errorType: 'database_constraint', status: 500 });
    const serialized = JSON.stringify([diagnostics[0]!.message, fields, serializeErr(err)]);
    assert.notInclude(serialized, 'SENTINEL_SQL_TEXT');
    assert.notInclude(serialized, 'SENTINEL_PAYLOAD');
    assert.notInclude(serialized, error.message);
  });
  test('Vine validation takes the framework answer: 422 with its errors', async ({ assert }) => {
    const messages = [{ message: 'Email is required.', field: 'email', rule: 'required' }];
    const error = new vineErrors.E_VALIDATION_ERROR(messages);
    const { ctx, result } = context(error);
    await new HttpExceptionHandler().handle(error, ctx);
    assert.equal(result.status, 422);
    assert.deepEqual(result.body, { errors: messages });
  });
  test('planning operation refusals send the status and code their class states', async ({
    assert,
  }) => {
    const conflict = await answerOnPlanning(new PlanningConflictException('The record is in use.'));
    assert.equal(conflict.status, 409);
    assert.deepEqual(conflict.body, { error: 'The record is in use.' });

    const stale = await answerOnPlanning(new RecordChangedException('Reload first.'));
    assert.equal(stale.status, 409);
    assert.deepEqual(stale.body, { error: 'Reload first.', code: 'STALE_REVISION' });
  });
  test('planning restoration failures retain both typed count-bearing variants', async ({
    assert,
  }) => {
    for (const stale of [false, true]) {
      const error = stale
        ? new RestorationConfirmationStaleException(3)
        : new RestorationConfirmationRequiredException(3);
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
