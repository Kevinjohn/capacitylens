import { test } from '@japa/runner';
import app from '@adonisjs/core/services/app';
import router from '@adonisjs/core/services/router';

/** Each route line of `node ace masquerade:routes`, without column padding. */
async function routeReport() {
  const ace = await app.container.make('ace');
  ace.ui.switchMode('raw');
  const command = await ace.exec('masquerade:routes', []);
  command.assertSucceeded();
  return ace.ui.logger
    .getLogs()
    .flatMap((log) => log.message.split('\n'))
    .filter((line) => line.startsWith('  '))
    .map((line) => line.trim().replace(/\s+/g, ' '));
}

/**
 * Routes the package cannot classify. Each is public, or is about the signed-in person's own
 * account and carries `asOwnAccount()`, which refuses it while a view-as mode is active.
 */
const reviewedUnclassified = [
  'GET,HEAD /api/auth/me [UNCLASSIFIED READ]',
  'POST /api/auth/sign-up [UNCLASSIFIED MUTATION]',
  'POST /api/auth/sign-in [UNCLASSIFIED MUTATION]',
  'POST /api/auth/sign-out [UNCLASSIFIED MUTATION]',
  'POST /api/auth/password-confirmation [UNCLASSIFIED MUTATION]',
  'POST /api/auth/request-reset [UNCLASSIFIED MUTATION]',
  'POST /api/auth/inspect-reset [UNCLASSIFIED MUTATION]',
  'POST /api/auth/reset-password [UNCLASSIFIED MUTATION]',
  'POST /api/auth/change-password [UNCLASSIFIED MUTATION]',
  'POST /api/auth/delete-account [UNCLASSIFIED MUTATION]',
  'POST /api/auth/verification/send [UNCLASSIFIED MUTATION]',
  'POST /api/auth/verification/inspect [UNCLASSIFIED MUTATION]',
  'POST /api/auth/verification/complete [UNCLASSIFIED MUTATION]',
  'GET,HEAD /api/invites/:token/preview [UNCLASSIFIED READ]',
  'POST /api/invites/:token/signup [UNCLASSIFIED MUTATION]',
  'GET,HEAD /api/masquerade [UNCLASSIFIED READ]',
  'GET,HEAD /api/health [UNCLASSIFIED READ]',
  'GET,HEAD /health/live [UNCLASSIFIED READ]',
  'GET,HEAD /health/ready [UNCLASSIFIED READ]',
  'GET,HEAD /api/* [UNCLASSIFIED READ]',
  'GET,HEAD /* [UNCLASSIFIED READ]',
];

/** Member reads refused outright while a view-as mode is active. */
const sensitiveReads = [
  'GET,HEAD /api/companies/:companyId/planning/archive [BUSINESS READ] (sensitive)',
  'GET,HEAD /api/companies [BUSINESS READ] (sensitive)',
  'GET,HEAD /api/companies/:companyId/getting-started [BUSINESS READ] (sensitive)',
  'GET,HEAD /api/companies/:companyId/members [BUSINESS READ] (sensitive)',
  'GET,HEAD /api/companies/:companyId/invites [BUSINESS READ] (sensitive)',
  'GET,HEAD /api/admission [BUSINESS READ] (sensitive)',
  'GET,HEAD /api/admission/requests [BUSINESS READ] (sensitive)',
  'GET,HEAD /api/diagnostics [BUSINESS READ] (sensitive)',
];

/** The view-as controls, which always run as the signed-in person. */
const signedInPersonRoutes = [
  'POST /api/companies/:companyId/masquerade [RAW-GUARD BUSINESS MUTATION]',
  'DELETE /api/masquerade [RAW-GUARD BUSINESS MUTATION]',
];

test.group('view-as route classification', () => {
  test('every route keeps its reviewed view-as classification', async ({ assert }) => {
    const lines = await routeReport();
    const pick = (pattern: RegExp) => lines.filter((line) => pattern.test(line));

    assert.sameMembers(pick(/\[UNCLASSIFIED /), reviewedUnclassified);
    assert.sameMembers(pick(/\(sensitive\)$/), sensitiveReads);
    assert.sameMembers(pick(/\[RAW-GUARD /), signedInPersonRoutes);
    // Everything else is an unmarked member route; no route may allow writes under view-as.
    const memberRoutes = lines.filter(
      (line) =>
        !reviewedUnclassified.includes(line) &&
        !sensitiveReads.includes(line) &&
        !signedInPersonRoutes.includes(line)
    );
    assert.isAbove(memberRoutes.length, 0);
    for (const line of memberRoutes) assert.match(line, /\[BUSINESS (READ|MUTATION)\]$/);
  });

  test('own-account routes carry the account blocker, and only sign-out is exempt', async ({
    assert,
  }) => {
    const blocked = Object.values(router.toJSON())
      .flat()
      .filter((route) =>
        [...route.middleware.all()].some(
          (entry) =>
            typeof entry === 'object' &&
            'name' in entry &&
            entry.name === 'accountKitAccountBlocker'
        )
      )
      .map((route) => route.pattern);
    const ownAccount = reviewedUnclassified
      .map((line) => line.split(' ')[1]!)
      .filter((pattern) => pattern.startsWith('/api/auth/') || pattern.startsWith('/api/invites/'))
      .filter((pattern) => pattern !== '/api/auth/sign-out');
    assert.sameMembers(blocked, ownAccount);
  });
});
