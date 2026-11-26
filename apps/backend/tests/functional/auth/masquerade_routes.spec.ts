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
  'GET,HEAD /api/v1/auth/me [UNCLASSIFIED READ] (Account Kit blocker registered)',
  'POST /api/v1/auth/sign-up [UNCLASSIFIED MUTATION] (Account Kit blocker registered)',
  'POST /api/v1/auth/sign-in [UNCLASSIFIED MUTATION] (Account Kit blocker registered)',
  'POST /api/v1/auth/sign-out [UNCLASSIFIED MUTATION]',
  'POST /api/v1/auth/password-confirmation [UNCLASSIFIED MUTATION] (Account Kit blocker registered)',
  'POST /api/v1/auth/request-reset [UNCLASSIFIED MUTATION] (Account Kit blocker registered)',
  'POST /api/v1/auth/inspect-reset [UNCLASSIFIED MUTATION] (Account Kit blocker registered)',
  'POST /api/v1/auth/reset-password [UNCLASSIFIED MUTATION] (Account Kit blocker registered)',
  'POST /api/v1/auth/change-password [UNCLASSIFIED MUTATION] (Account Kit blocker registered)',
  'POST /api/v1/auth/delete-account [UNCLASSIFIED MUTATION] (Account Kit blocker registered)',
  'POST /api/v1/auth/verification/send [UNCLASSIFIED MUTATION] (Account Kit blocker registered)',
  'POST /api/v1/auth/verification/inspect [UNCLASSIFIED MUTATION] (Account Kit blocker registered)',
  'POST /api/v1/auth/verification/complete [UNCLASSIFIED MUTATION] (Account Kit blocker registered)',
  'GET,HEAD /api/v1/invitations/:token/preview [UNCLASSIFIED READ] (Account Kit blocker registered)',
  'POST /api/v1/invitations/:token/sign-up [UNCLASSIFIED MUTATION] (Account Kit blocker registered)',
  'GET,HEAD /api/v1/masquerade [UNCLASSIFIED READ]',
  'GET,HEAD /api/v1/health [UNCLASSIFIED READ]',
  'GET,HEAD /health/live [UNCLASSIFIED READ]',
  'GET,HEAD /health/ready [UNCLASSIFIED READ]',
  'GET,HEAD /api/v1/* [UNCLASSIFIED READ]',
  'GET,HEAD /* [UNCLASSIFIED READ]',
];

/** Member reads refused outright while a view-as mode is active. */
const sensitiveReads = [
  'GET,HEAD /api/v1/companies/:companyId/planning/archive [BUSINESS READ] (sensitive)',
  'GET,HEAD /api/v1/companies [BUSINESS READ] (sensitive)',
  'GET,HEAD /api/v1/companies/:companyId/getting-started [BUSINESS READ] (sensitive)',
  'GET,HEAD /api/v1/companies/:companyId/members [BUSINESS READ] (sensitive)',
  'GET,HEAD /api/v1/companies/:companyId/invitations [BUSINESS READ] (sensitive)',
  'GET,HEAD /api/v1/admission [BUSINESS READ] (sensitive)',
  'GET,HEAD /api/v1/admission/requests [BUSINESS READ] (sensitive)',
  'GET,HEAD /api/v1/diagnostics [BUSINESS READ] (sensitive)',
];

/** The view-as controls, which always run as the signed-in person. */
const signedInPersonRoutes = [
  'POST /api/v1/companies/:companyId/masquerade [RAW-GUARD BUSINESS MUTATION]',
  'DELETE /api/v1/masquerade [RAW-GUARD BUSINESS MUTATION]',
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
      .filter(
        (pattern) =>
          pattern.startsWith('/api/v1/auth/') || pattern.startsWith('/api/v1/invitations/')
      )
      .filter((pattern) => pattern !== '/api/v1/auth/sign-out');
    assert.sameMembers(blocked, ownAccount);
  });
});
