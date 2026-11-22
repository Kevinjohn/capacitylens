import { test } from '@japa/runner';
import {
  authenticatedDataClient,
  createFixtureCompanyForOwner,
  resetAuthenticatedClient,
  resetAuthenticatedData,
} from '#tests/helpers/authenticated_data_fixture';
import { LoggerFactory } from '@adonisjs/logger/factories';
import { freshDatabase } from '#tests/helpers/fresh_database';
import db from '@adonisjs/lucid/services/db';
import Company from '#models/company';
import logger from '@adonisjs/core/services/logger';
import env from '#start/env';
import loggerConfig from '#config/logger';
import { randomUUID } from 'node:crypto';
import {
  configureAuth,
  newAllocation,
  planningUrl,
  resetPlanningFixture,
  session as withPlanningSession,
  signIn,
} from '#tests/functional/planning/helpers';

const privateError = 'SENTINEL_PRIVATE_EXCEPTION_VALUE';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function captureLogs<T>(
  work: () => Promise<T>,
  interceptChild?: (child: ReturnType<typeof logger.child>) => void
): Promise<{ output: string; result: T }> {
  const lines: string[] = [];
  const capture = new LoggerFactory()
    .merge({ ...loggerConfig.loggers.app, level: 'trace' })
    .pushLogsTo(lines)
    .create();
  const instrument = (child: ReturnType<typeof capture.child>) => {
    interceptChild?.(child);
    const originalChild = child.child;
    child.child = ((...args: Parameters<typeof child.child>) =>
      instrument(originalChild.apply(child, args))) as typeof child.child;
    return child;
  };
  const originalChild = logger.child;
  logger.child = ((...args: Parameters<typeof logger.child>) =>
    instrument(capture.child(...args))) as typeof logger.child;
  try {
    const result = await work();
    return { output: lines.join('\n'), result };
  } finally {
    logger.child = originalChild;
  }
}

const originalLoggingSetting = env.get('CAPACITYLENS_LOG');

test.group('general HTTP logging privacy', (group) => {
  group.setup(() => freshDatabase());
  group.setup(() => env.set('CAPACITYLENS_LOG', '1'));
  group.teardown(() => {
    env.set('CAPACITYLENS_LOG', originalLoggingSetting ?? '');
    if (originalLoggingSetting === undefined) delete process.env.CAPACITYLENS_LOG;
  });

  test('redacts structured request/response containers and private error properties', async ({
    assert,
  }) => {
    const lines: string[] = [];
    const capture = new LoggerFactory()
      .merge({ ...loggerConfig.loggers.app, level: 'trace' })
      .pushLogsTo(lines)
      .create();
    const cause = new Error('SENTINEL_CAUSE_MESSAGE');
    const error = Object.assign(new Error('SENTINEL_ERROR_MESSAGE'), {
      cause,
      privateDiagnostic: 'SENTINEL_ERROR_CUSTOM_VALUE',
    });
    capture.warn(
      {
        event: 'test.logger.redaction',
        method: 'POST',
        path: '/api/safe-pattern',
        req: {
          headers: {
            authorization: 'Bearer SENTINEL_REQ_AUTHORIZATION',
            cookie: 'session=SENTINEL_REQ_COOKIE',
          },
          body: { payload: 'SENTINEL_REQ_BODY' },
        },
        res: {
          headers: { 'set-cookie': 'session=SENTINEL_RES_COOKIE' },
          body: { payload: 'SENTINEL_RES_BODY' },
        },
        request: {
          headers: { authorization: 'Bearer SENTINEL_REQUEST_AUTHORIZATION' },
          body: { payload: 'SENTINEL_REQUEST_BODY' },
        },
        response: {
          headers: { 'set-cookie': 'session=SENTINEL_RESPONSE_COOKIE' },
          body: { payload: 'SENTINEL_RESPONSE_BODY' },
        },
        err: error,
      },
      'Structured logging privacy test'
    );

    const output = lines.join('\n');
    for (const secret of [
      'SENTINEL_REQ_AUTHORIZATION',
      'SENTINEL_REQ_COOKIE',
      'SENTINEL_REQ_BODY',
      'SENTINEL_RES_COOKIE',
      'SENTINEL_RES_BODY',
      'SENTINEL_REQUEST_AUTHORIZATION',
      'SENTINEL_REQUEST_BODY',
      'SENTINEL_RESPONSE_COOKIE',
      'SENTINEL_RESPONSE_BODY',
      'SENTINEL_ERROR_MESSAGE',
      'SENTINEL_CAUSE_MESSAGE',
      'SENTINEL_ERROR_CUSTOM_VALUE',
    ]) {
      assert.notInclude(output, secret);
    }
    assert.include(output, '"event":"test.logger.redaction"');
    assert.include(output, '"path":"/api/safe-pattern"');
    assert.include(output, '"err":{"category":"unexpected"}');
  });

  test('keeps completion logging disabled by default and for other values', async ({
    client,
    assert,
  }) => {
    for (const setting of ['', '0']) {
      env.set('CAPACITYLENS_LOG', setting);
      try {
        const { output, result } = await captureLogs(() => client.visit('api.health').send());
        assert.equal(result.status(), 200);
        assert.equal(output, '');
      } finally {
        env.set('CAPACITYLENS_LOG', '1');
      }
    }
  });

  test('keeps unexpected error diagnostics when routine request logging is disabled', async ({
    client,
    assert,
  }) => {
    client = await resetAuthenticatedClient(client, true);
    const secret = 'SENTINEL_DISABLED_LOG_PRIVATE_EXCEPTION';
    const originalQuery = Company.query;
    env.set('CAPACITYLENS_LOG', '0');
    Company.query = (() => {
      throw new Error(secret);
    }) as typeof Company.query;
    try {
      const { output, result } = await captureLogs(() =>
        client.visit('api.company_state.show').qs({ companyId: 'a-studio' }).send()
      );
      assert.equal(result.status(), 500);
      assert.include(output, '"event":"http.request.error"');
      assert.include(output, '"errorType":"unexpected"');
      assert.include(output, '"method":"GET"');
      assert.include(output, '"path":"/api/state"');
      assert.include(output, '"status":500');
      assert.notInclude(output, 'http.request.completed');
      assert.notInclude(output, secret);
    } finally {
      Company.query = originalQuery;
      env.set('CAPACITYLENS_LOG', '1');
    }
  });

  test('logs the class, stack frames and causes of an unexpected failure without its message', async ({
    client,
    assert,
  }) => {
    client = await resetAuthenticatedClient(client, true);
    const originalQuery = Company.query;
    Company.query = (() => {
      throw new Error('secret Bruce Wayne', { cause: new TypeError('inner') });
    }) as typeof Company.query;
    try {
      const { output, result } = await captureLogs(() =>
        client.visit('api.company_state.show').qs({ companyId: 'a-studio' }).send()
      );
      assert.equal(result.status(), 500);
      const line = output.split('\n').find((entry) => entry.includes('"http.request.error"'));
      assert.isDefined(line);
      const logged = JSON.parse(line!) as { errorName?: string; stack?: string[] };
      assert.include(line!, '"errorName":"Error"');
      assert.include(line!, '"causes":["TypeError"]');
      assert.isTrue(logged.stack?.some((frame) => frame.includes(' at ')));
      assert.notInclude(output, 'Bruce Wayne');
      assert.notInclude(output, 'inner');
    } finally {
      Company.query = originalQuery;
    }
  });

  test('preserves committed writes and emits a safe signal if completion logging fails', async ({
    client,
    assert,
  }) => {
    const session = await resetAuthenticatedData(client, false);
    await createFixtureCompanyForOwner(session.userId, 'Wayne Enterprises', 'a-studio');
    client = authenticatedDataClient(client, session.cookie);
    const secret = 'SENTINEL_COMPLETION_LOG_FAILURE';
    const { output, result } = await captureLogs(
      () =>
        client
          .visit('api.example_data.store', { companyId: 'a-studio' })
          .header('sec-fetch-site', 'same-origin')
          .json({})
          .send(),
      (child) => {
        const originalLog = child.log;
        child.log = ((...args: Parameters<typeof child.log>) => {
          if (args[0] === 'info') throw new Error(secret);
          return originalLog.apply(child, args);
        }) as typeof child.log;
      }
    );
    const committed = await db
      .from('audit_entries')
      .where({ company_id: 'a-studio', action: 'exampleData' })
      .first();

    assert.isDefined(committed);
    assert.equal(result.status(), 201);
    assert.isUndefined(result.header('x-capacitylens-audit-warning'));
    assert.include(output, '"event":"http.request.logging_failed"');
    assert.notInclude(output, secret);
  });

  test('names the planning operation on a mutation completion line', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const data = await resetPlanningFixture();
    const { cookie } = await signIn(client);
    const { output, result } = await captureLogs(() =>
      withPlanningSession(client.post(`${planningUrl}/mutations`), cookie)
        .json({
          mutationId: randomUUID(),
          baseRevision: 0,
          intent: { operation: 'allocation.create', allocation: newAllocation(data) },
        })
        .send()
    );

    assert.equal(result.status(), 200);
    assert.include(output, '"path":"/api/companies/:companyId/planning/mutations"');
    assert.include(output, '"planningOperation":"allocation.create"');
  });

  test('writes bounded completion diagnostics without secrets from unmatched encoded paths or headers', async ({
    client,
    assert,
  }) => {
    const auth = 'SENTINEL_BEARER_AUTHORIZATION';
    const cookie = 'SENTINEL_SESSION_COOKIE';
    const query = 'SENTINEL_QUERY_SECRET';
    const token = 'SENTINEL/ENCODED_INVITE_PATH_TOKEN';
    const { output, result } = await captureLogs(() =>
      client
        .get(`/api/%2569nvites%252f${encodeURIComponent(token)}/preview?state=${query}`)
        .header('authorization', `Bearer ${auth}`)
        .header('cookie', `session=${cookie}`)
        .send()
    );

    assert.equal(result.status(), 401);
    assert.include(output, 'GET');
    assert.include(output, '"path":"/api/*"');
    assert.include(output, '401');
    assert.notInclude(output, auth);
    assert.notInclude(output, cookie);
    assert.notInclude(output, query);
    assert.notInclude(output, token);
  });

  test('ignores supplied request ids and logs a distinct server id for every request', async ({
    client,
    assert,
  }) => {
    const suppliedId = `SENTINEL_${'UNTRUSTED'.repeat(512)}`;
    const { output } = await captureLogs(() =>
      Promise.all(
        Array.from({ length: 3 }, () =>
          client.visit('api.health').header('x-request-id', suppliedId).send()
        )
      )
    );

    assert.notInclude(output, suppliedId);
    const requestIds = output
      .trim()
      .split('\n')
      .map((line) => String((JSON.parse(line) as Record<string, unknown>)['request_id']));
    assert.lengthOf(requestIds, 3);
    assert.lengthOf(new Set(requestIds), 3);
    for (const requestId of requestIds) assert.match(requestId, UUID);
  });

  test('logs malformed body-parser requests without including their body', async ({
    client,
    assert,
  }) => {
    const secret = 'SENTINEL_MALFORMED_REQUEST_BODY';
    const { output, result } = await captureLogs(() =>
      client
        .visit('api.imports.store')
        .header('sec-fetch-site', 'same-origin')
        .unsafeJson(`{"secret":"${secret}"`)
        .send()
    );

    assert.equal(result.status(), 400);
    assert.include(output, 'POST');
    assert.include(output, '"path":"/api/transfer/apply"');
    assert.include(output, '400');
    assert.notInclude(output, secret);
  });

  test('rejects transfer parser input without logging private messages or stacks', async ({
    client,
    assert,
  }) => {
    client = await resetAuthenticatedClient(client, true);
    const secret = 'SENTINEL_IMPORT_PARSER_VALUE';
    const { output, result } = await captureLogs(() =>
      client
        .visit('api.imports.store')
        .header('sec-fetch-site', 'same-origin')
        .json({ companyId: 'a-studio', document: { secret }, baseRevision: 0 })
        .send()
    );

    assert.equal(result.status(), 400);
    assert.include(output, '/api/transfer/apply');
    assert.notInclude(output, secret);
    assert.notInclude(output, 'stack');
  });

  test('reports unexpected errors with useful classification and no private exception data', async ({
    client,
    assert,
  }) => {
    client = await resetAuthenticatedClient(client, true);
    const originalQuery = Company.query;
    Company.query = (() => {
      throw new Error(privateError);
    }) as typeof Company.query;
    try {
      const captured = await captureLogs(() =>
        client.visit('api.company_state.show').qs({ companyId: 'a-studio' }).send()
      );
      assert.notInclude(captured.output, privateError);
      assert.equal(captured.result.status(), 500);
      assert.deepEqual(captured.result.body(), { error: 'Internal server error.' });
      assert.include(captured.output, 'GET');
      assert.include(captured.output, '/api/state');
      assert.include(captured.output, '500');
    } finally {
      Company.query = originalQuery;
    }
  });
});
