import { test } from '@japa/runner';
import type { HttpContext } from '@adonisjs/core/http';
import { errors as vineErrors } from '@vinejs/vine';
import { buildBetaExport } from '@capacitylens/shared/data/betaTransfer';
import { seed } from '@capacitylens/shared/data/seed';
import GettingStartedController from '#controllers/getting_started_controller';
import { parseRequestDocument } from '#services/beta_account_transfer';

// Expected invalid input becomes a 400; anything else must reach the exception handler and reporting.

test.group('Expected input errors', () => {
  test('a request document parses, or is null only when it is invalid input', ({ assert }) => {
    const document = buildBetaExport(seed(), { accountId: 'a-studio', completeness: 'full' });
    assert.equal(parseRequestDocument(document)?.format, document.format);
    assert.isNull(parseRequestDocument({ format: 'something else' }));
    assert.isNull(parseRequestDocument(undefined));
    let nested: unknown[] = [];
    for (let depth = 0; depth < 200_000; depth += 1) nested = [nested];
    assert.isNull(parseRequestDocument({ ...document, data: nested }));
  });

  test('an unexpected failure while reading a request document propagates', ({ assert }) => {
    const fault = new TypeError('unexpected reader fault');
    const document = {
      get format(): never {
        throw fault;
      },
    };
    assert.throws(() => parseRequestDocument(document), 'unexpected reader fault');
  });

  test('getting-started dismissal reports only validation failures as invalid input', async ({
    assert,
  }) => {
    const context = (failure: unknown) =>
      ({
        params: { accountId: 'a-studio' },
        request: {
          body: () => ({}),
          validateUsing: async () => {
            throw failure;
          },
        },
        response: { badRequest: (body: unknown) => ({ status: 400, body }) },
      }) as unknown as HttpContext;
    const controller = new GettingStartedController();

    assert.deepEqual(await controller.update(context(new vineErrors.E_VALIDATION_ERROR([]))), {
      status: 400,
      body: { error: 'dismissed must be true.' },
    });
    await assert.rejects(
      () => controller.update(context(new TypeError('unexpected validator fault'))),
      'unexpected validator fault'
    );
  });
});
