import { publicOrigin } from '#config/public_origin'
import app from '@adonisjs/core/services/app'
import env from '#start/env'
import { createActionUrls, createMailNotifications, defineConfig } from 'adonisjs-account-kit'
import { withAdmissionCleanup, withInvitationEvidence } from 'adonisjs-account-kit/admission'
import {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_INPUT_CODE_UNITS,
} from '@capacitylens/shared/domain/password'
import {
  authorize,
  onCredentialsChangedTransaction,
  onInvitationAccepted,
} from '#services/account_kit/policy'
import { registrationDisplayName, users } from '#services/account_kit/users'
import { SESSION_IDLE_EXPIRY } from '#services/auth/session_expiry'

export default defineConfig({
  users,
  enabled: [
    'passwordReset',
    'emailVerification',
    'emailPasswordManagement',
    'registration',
    'invitations',
    'sessionManagement',
  ],
  // Ordinary registration exists only behind the application's own sign-up route, after setup.
  registration: {
    availability: env.get('CAPACITYLENS_ALLOW_OPEN_SIGNUP') ? 'application' : 'closed',
    mapFields: (data) => ({ name: registrationDisplayName(data) }),
  },
  authentication: { strategy: 'session', guard: 'web' },
  sessionManagement: { idleExpiry: SESSION_IDLE_EXPIRY },
  // One lifetime for every invitation; the documentation names it.
  expiresIn: { invitation: '7d' },
  // The routes count Unicode code points against the shared policy; these are the Kit's UTF-16 bounds.
  passwordPolicy: { minLength: MIN_PASSWORD_LENGTH, maxLength: MAX_PASSWORD_INPUT_CODE_UNITS },
  limiterSecret: env.get('APP_KEY'),
  limiterNamespace: 'capacitylens',
  ...(app.inTest ? { throttle: { requests: 100, duration: '15m' } } : {}),
  authorize,
  urls: createActionUrls({
    backendOrigin: publicOrigin.origin,
    appFrontendUrl: publicOrigin.origin,
    destinations: {
      passwordReset: 'reset-password',
      emailVerification: 'verify-email',
      invitation: 'invite',
      emailChange: 'confirm-email-change',
    },
    environment: app.inProduction ? 'production' : app.inTest ? 'test' : 'development',
  }),
  notify: createMailNotifications({
    from: env.get('CAPACITYLENS_MAIL_FROM') || 'noreply@capacitylens.local',
    brandName: 'CapacityLens',
  }),
  delivery: 'best-effort',
  onInvitationAccepted: withInvitationEvidence(onInvitationAccepted),
  onAccountDeletingTransaction: withAdmissionCleanup(),
  onCredentialsChangedTransaction,
})
