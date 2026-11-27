// Sessions use the kit's database-backed session registry with the idle expiry from
// `SESSION_IDLE_EXPIRY`.

import { publicOrigin } from '#config/public_origin'
import app from '@adonisjs/core/services/app'
import env from '#start/env'
import {
  createActionUrls,
  createMailNotifications,
  defineConfig,
} from '@kevinjohn/adonisjs-account-kit'
import {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_INPUT_CODE_UNITS,
} from '@capacitylens/shared/domain/password'
import { SESSION_IDLE_EXPIRY } from '#config/session'

export default defineConfig({
  enabled: [
    'passwordReset',
    'emailVerification',
    'emailPasswordManagement',
    'registration',
    'invitations',
    'sessionManagement',
    'accountDeletion',
  ],
  // Ordinary registration exists only behind the application's own sign-up route, after setup.
  registration: {
    availability: env.get('CAPACITYLENS_ALLOW_OPEN_SIGN_UP') ? 'application' : 'closed',
  },
  authentication: { strategy: 'session', guard: 'web' },
  // Invitations a deleted person sent stay acceptable; the Kit clears their inviter instead.
  accountDeletion: { invitations: 'keep' },
  sessionManagement: { idleExpiry: SESSION_IDLE_EXPIRY },
  // One lifetime for every invitation; the documentation names it.
  expiresIn: { invitation: '7d' },
  // The routes count Unicode code points against the shared limits; these are the Kit's UTF-16 bounds.
  passwordPolicy: { minLength: MIN_PASSWORD_LENGTH, maxLength: MAX_PASSWORD_INPUT_CODE_UNITS },
  limiterSecret: env.get('APP_KEY'),
  limiterNamespace: 'capacitylens',
  ...(app.inTest ? { throttle: { requests: 100, duration: '15m' } } : {}),
  urls: createActionUrls({
    backendOrigin: publicOrigin.origin,
    appFrontendUrl: publicOrigin.origin,
    destinations: {
      passwordReset: 'reset-password',
      emailVerification: 'verify-email',
      invitation: 'invitation',
      emailChange: 'confirm-email-change',
    },
    environment: app.inProduction ? 'production' : app.inTest ? 'test' : 'development',
  }),
  notify: createMailNotifications({
    from: env.get('CAPACITYLENS_MAIL_FROM') || 'noreply@capacitylens.local',
    brandName: 'CapacityLens',
  }),
  delivery: 'best-effort',
})
