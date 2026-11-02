import { RestorationConfirmationError } from '#services/planning_operations/restoration';
import { errors as vineErrors } from '@vinejs/vine';
import { test } from '@japa/runner';
import type { HttpContext } from '@adonisjs/core/http';
import { ThrottledError, PostCommitError, accountErrorResponse } from 'adonisjs-account-kit';
import { AdmissionRequiredError } from 'adonisjs-account-kit/admission';
import PlanningController from '#controllers/planning_controller';
import HttpExceptionHandler from '#exceptions/handler';

function context(error: unknown) {
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
      route: { pattern: '/api/accounts/:accountId/resources' },
      get params() {
        throw error;
      },
    } as unknown as HttpContext,
  };
}

test.group('product error adapters', () => {
  for (const adapter of ['global', 'planning'] as const) {
    test(`${adapter} preserves kit codes, status, headers and committed metadata`, async ({
      assert,
    }) => {
      for (const error of [new ThrottledError(37), new PostCommitError()]) {
        const { ctx, result } = context(error);
        if (adapter === 'global') await new HttpExceptionHandler().handle(error, ctx);
        else {
          try {
            await new PlanningController().lookup(ctx);
          } catch (unhandled) {
            await new HttpExceptionHandler().handle(unhandled, ctx);
          }
        }
        const expected = accountErrorResponse(error)!;
        assert.equal(result.status, expected.status);
        assert.deepEqual(result.headers, expected.headers);
        assert.deepEqual(result.body, {
          error: expected.body.message,
          code: expected.body.code,
          ...(expected.body.committed ? { committed: true } : {}),
        });
      }
    });
    test(`${adapter} preserves admission decisions`, async ({ assert }) => {
      const decision = { admitted: false, requirements: { invitation: { met: false } } };
      const error = new AdmissionRequiredError(decision);
      const { ctx, result } = context(error);
      if (adapter === 'global') await new HttpExceptionHandler().handle(error, ctx);
      else {
        try {
          await new PlanningController().lookup(ctx);
        } catch (unhandled) {
          await new HttpExceptionHandler().handle(unhandled, ctx);
        }
      }
      assert.equal(result.status, 403);
      assert.properties(result.body as object, ['error', 'code', 'decision']);
      assert.deepEqual((result.body as { decision: unknown }).decision, decision);
      assert.equal((result.body as { code: string }).code, 'ADMISSION_REQUIRED');
    });
  }
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
      path: '/api/accounts/:accountId/resources',
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
  test('planning restoration failures retain both typed count-bearing variants', async ({
    assert,
  }) => {
    for (const stale of [false, true]) {
      const error = new RestorationConfirmationError(3, stale);
      const { ctx, result } = context(error);
      await new PlanningController().lookup(ctx);
      assert.equal(result.status, 409);
      assert.deepEqual(result.body, {
        error: error.message,
        code: stale ? 'RESTORATION_CONFIRMATION_STALE' : 'RESTORATION_CONFIRMATION_REQUIRED',
        restorableItemCount: 3,
      });
    }
  });
});
