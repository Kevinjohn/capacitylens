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
import { PlanningOperationException } from '#exceptions/planning_operation_exception';
import { RestorationConfirmationException } from '#exceptions/restoration_confirmation_exception';

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
});
