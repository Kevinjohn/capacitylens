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
  test('identity and admission refusals keep the wording stated for each surface', async ({
    assert,
  }) => {
    const identity = new IdentityAuthorizationException('Invalid membership role.');
    const decision = { admitted: false, requirements: { invitation: { met: false } } };
    const admission = new AdmissionRequiredError(decision);
    const viaHandler = async (error: unknown) => {
      const { ctx, result } = context(error);
      await new HttpExceptionHandler().handle(error, ctx);
      return result.body;
    };
    const viaPlanning = async (error: unknown) => {
      const result = await answerOnPlanning(error);
      return result.body;
    };
    assert.deepEqual(await viaHandler(identity), {
      error: 'Invalid membership role.',
      code: 'IDENTITY_AUTHORIZATION_DENIED',
    });
    assert.deepEqual(await viaPlanning(identity), {
      error: 'Planning access is unavailable.',
      code: 'ACCOUNT_MEMBERSHIP_LOST',
    });
    const admissionRoute = context(identity, 'api.member_resource_links.update');
    await new HttpExceptionHandler().handle(identity, admissionRoute.ctx);
    assert.deepEqual(admissionRoute.result.body, {
      error: 'Forbidden.',
      code: 'IDENTITY_AUTHORIZATION_DENIED',
    });
    assert.deepEqual(await viaHandler(admission), {
      error: 'Your access to this company is waiting on admission.',
      code: 'ADMISSION_REQUIRED',
      decision,
    });
    assert.deepEqual(await viaPlanning(admission), {
      error: 'Company access needs admission.',
      code: 'ADMISSION_REQUIRED',
      decision,
    });
  });
  test('each surface keeps its wording for identity, admission and Vine refusals', async ({
    assert,
  }) => {
    const decision = { admitted: false, requirements: { invitation: { met: false } } };
    const routes = {
      product: 'api.companies.index',
      planning: 'api.planning.show',
      admission: 'api.member_resource_links.update',
    } as const;
    const productAdmission = 'Your access to this company is waiting on admission.';
    const cases = [
      {
        error: () => new IdentityAuthorizationException('Invalid membership role.'),
        expected: {
          product: { error: 'Invalid membership role.', code: 'IDENTITY_AUTHORIZATION_DENIED' },
          planning: { error: 'Planning access is unavailable.', code: 'ACCOUNT_MEMBERSHIP_LOST' },
          admission: { error: 'Forbidden.', code: 'IDENTITY_AUTHORIZATION_DENIED' },
        },
      },
      {
        error: () => new AdmissionRequiredError(decision),
        expected: {
          product: { error: productAdmission, code: 'ADMISSION_REQUIRED', decision },
          planning: {
            error: 'Company access needs admission.',
            code: 'ADMISSION_REQUIRED',
            decision,
          },
          admission: { error: productAdmission, code: 'ADMISSION_REQUIRED', decision },
        },
      },
      {
        error: () => new vineErrors.E_VALIDATION_ERROR([]),
        expected: {
          product: { error: 'Invalid request.', code: 'VALIDATION_ERROR' },
          planning: { error: 'Invalid planning input.', code: 'VALIDATION_ERROR' },
          admission: { error: 'Invalid request.', code: 'VALIDATION_ERROR' },
        },
      },
    ];
    for (const { error, expected } of cases) {
      for (const surface of ['product', 'planning', 'admission'] as const) {
        const thrown = error();
        const { ctx, result } = context(thrown, routes[surface]);
        await new HttpExceptionHandler().handle(thrown, ctx);
        assert.deepEqual(
          result.body,
          expected[surface],
          `${thrown.constructor.name} on ${surface}`
        );
      }
    }
  });
  test('the export download keeps the planning wording for identity and admission refusals', async ({
    assert,
  }) => {
    const decision = { admitted: false, requirements: { invitation: { met: false } } };
    const cases = [
      {
        thrown: new IdentityAuthorizationException('Masquerade company access changed.'),
        expected: { error: 'Planning access is unavailable.', code: 'ACCOUNT_MEMBERSHIP_LOST' },
      },
      {
        thrown: new AdmissionRequiredError(decision),
        expected: {
          error: 'Company access needs admission.',
          code: 'ADMISSION_REQUIRED',
          decision,
        },
      },
    ];
    for (const { thrown, expected } of cases) {
      const { ctx, result } = context(thrown, 'api.company_exports.show');
      await new HttpExceptionHandler().handle(thrown, ctx);
      assert.deepEqual(result.body, expected, thrown.constructor.name);
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
