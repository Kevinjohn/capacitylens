import { spawn } from 'node:child_process';
import { test } from '@japa/runner';
import { ports, resolvePortLane, workerPorts } from '@capacitylens/tooling/ports';
import { E2E_SCRIPT_TEST_SLOTS } from '@capacitylens/tooling/e2eTestSlots';
import { waitForReadiness, waitForPortRelease, stop } from '#tests/helpers/state/e2e_server';

test('both E2E server flavours require sign-in and expose no installation reset route', async ({
  assert,
}) => {
  for (const flavour of ['db', 'auth'] as const) {
    const portLane = ports();
    const slot = E2E_SCRIPT_TEST_SLOTS.serverBoundary;
    const port = flavour === 'db' ? workerPorts(resolvePortLane(), slot).api : portLane.authApi;
    const args = ['scripts/e2e_server.mjs', flavour];
    if (flavour === 'db') args.push('--slot', String(slot));
    const child = spawn(process.execPath, args, {
      cwd: new URL('../../../', import.meta.url),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    const capture = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-12_000);
    };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);
    try {
      await waitForReadiness(child, `http://127.0.0.1:${port}/health/ready`, flavour, () => output);
      const resetUrl = `http://127.0.0.1:${port}/api/v1/test/reset`;
      {
        const anonymousReset = await fetch(resetUrl, {
          method: 'POST',
          headers: { 'sec-fetch-site': 'same-origin' },
        });
        assert.equal(anonymousReset.status, 404, 'no reset route answers unauthenticated callers');
        const anonymousState = await fetch(`http://127.0.0.1:${port}/api/v1/state`);
        assert.equal(anonymousState.status, 401, 'persistent state requires sign-in');

        const signedIn = await fetch(`http://127.0.0.1:${port}/api/v1/auth/sign-in`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
          body: JSON.stringify({
            email: 'admin@admin.admin',
            password: 'auth-e2e-password-2026',
          }),
        });
        assert.equal(
          signedIn.status,
          200,
          'the disposable administrator signs in after fixture readiness'
        );
        const cookie = signedIn.headers
          .getSetCookie()
          .map((value) => value.split(';', 1)[0])
          .join('; ');
        assert.isNotEmpty(cookie, 'password sign-in creates a native session cookie');

        const contextResponse = await fetch(`http://127.0.0.1:${port}/api/v1/masquerade`, {
          headers: { cookie, 'sec-fetch-site': 'same-origin' },
        });
        assert.equal(contextResponse.status, 200, 'signed-in requests resolve their context');
        const { data: context } = (await contextResponse.json()) as {
          data: { masqueradeToken?: unknown };
        };
        assert.isString(context.masqueradeToken, 'signed-in requests receive a masquerade token');

        const session = await fetch(`http://127.0.0.1:${port}/api/v1/auth/me`, {
          headers: { cookie },
        });
        assert.equal(
          session.status,
          200,
          'the database-backed session authenticates the next request'
        );

        const memberlessReset = await fetch(resetUrl, {
          method: 'POST',
          headers: {
            cookie,
            'content-type': 'application/json',
            'sec-fetch-site': 'same-origin',
            'X-Masquerade-Context': context.masqueradeToken as string,
          },
          body: JSON.stringify({ seed: true }),
        });
        assert.equal(
          memberlessReset.status,
          404,
          'no reset route answers an authenticated administrator'
        );
        assert.deepEqual(await memberlessReset.json(), {
          code: 'NOT_FOUND',
          error: 'Not found.',
        });
      }
    } finally {
      await stop(child, port);
      assert.isTrue(
        await waitForPortRelease(port),
        `${flavour} E2E server should release port ${port}`
      );
    }
  }
});
