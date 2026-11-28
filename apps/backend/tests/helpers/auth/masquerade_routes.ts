import app from '@adonisjs/core/services/app'
import { execCommand } from '#tests/helpers/auth/commands'

/** Each route line of `node ace masquerade:routes`, without column padding. */
export async function routeReport() {
  const ace = await app.container.make('ace')
  ace.ui.switchMode('raw')
  const command = await execCommand('masquerade:routes', [])
  command.assertSucceeded()
  return ace.ui.logger
    .getLogs()
    .flatMap((log) => log.message.split('\n'))
    .filter((line) => line.startsWith('  '))
    .map((line) => line.trim().replace(/\s+/g, ' '))
}

/**
 * Routes the package cannot classify. Each is public, or is about the signed-in person's own
 * account and carries `accountKitAccountBlocker`, which refuses it while a view-as mode is active.
 */
export const reviewedUnclassified = [
  'GET,HEAD /api/v1/auth/me [UNCLASSIFIED READ] (Account Kit blocker registered)',
  'POST /api/v1/auth/sign-up [UNCLASSIFIED MUTATION] (Account Kit blocker registered)',
  'POST /api/v1/auth/sign-in [UNCLASSIFIED MUTATION] (Account Kit blocker registered)',
  'POST /api/v1/auth/sign-out [UNCLASSIFIED MUTATION]',
  'POST /api/v1/auth/request-reset [UNCLASSIFIED MUTATION] (Account Kit blocker registered)',
  'POST /api/v1/auth/inspect-reset [UNCLASSIFIED MUTATION] (Account Kit blocker registered)',
  'POST /api/v1/auth/reset-password [UNCLASSIFIED MUTATION] (Account Kit blocker registered)',
  'POST /api/v1/auth/verification/inspect [UNCLASSIFIED MUTATION] (Account Kit blocker registered)',
  'POST /api/v1/auth/verification/complete [UNCLASSIFIED MUTATION] (Account Kit blocker registered)',
  'GET,HEAD /api/v1/invitations/:token/preview [UNCLASSIFIED READ] (Account Kit blocker registered)',
  'POST /api/v1/invitations/:token/sign-up [UNCLASSIFIED MUTATION] (Account Kit blocker registered)',
  'GET,HEAD /api/v1/masquerade [UNCLASSIFIED READ]',
  'GET,HEAD /health/live [UNCLASSIFIED READ]',
  'GET,HEAD /health/ready [UNCLASSIFIED READ]',
  'GET,HEAD /* [UNCLASSIFIED READ]',
]

/** Member reads refused outright while a view-as mode is active. */
export const sensitiveReads = [
  'GET,HEAD /api/v1/companies/:companyId/planning/archive [BUSINESS READ] (sensitive)',
  'GET,HEAD /api/v1/companies [BUSINESS READ] (sensitive)',
  'GET,HEAD /api/v1/companies/:companyId/getting-started [BUSINESS READ] (sensitive)',
  'GET,HEAD /api/v1/companies/:companyId/members [BUSINESS READ] (sensitive)',
  'GET,HEAD /api/v1/companies/:companyId/invitations [BUSINESS READ] (sensitive)',
  'GET,HEAD /api/v1/admission [BUSINESS READ] (sensitive)',
  'GET,HEAD /api/v1/admission/requests [BUSINESS READ] (sensitive)',
  'GET,HEAD /api/v1/diagnostics [BUSINESS READ] (sensitive)',
]

/** The view-as controls and authenticated own-account routes, which always run as the signed-in person. */
export const signedInPersonRoutes = [
  'POST /api/v1/auth/password-confirmation [RAW-GUARD BUSINESS MUTATION] (Account Kit blocker registered)',
  'POST /api/v1/auth/change-password [RAW-GUARD BUSINESS MUTATION] (Account Kit blocker registered)',
  'POST /api/v1/auth/delete-account [RAW-GUARD BUSINESS MUTATION] (Account Kit blocker registered)',
  'POST /api/v1/auth/verification/send [RAW-GUARD BUSINESS MUTATION] (Account Kit blocker registered)',
  'POST /api/v1/companies/:companyId/masquerade [RAW-GUARD BUSINESS MUTATION]',
  'DELETE /api/v1/masquerade [RAW-GUARD BUSINESS MUTATION]',
]
