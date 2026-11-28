import router from '@adonisjs/core/services/router'
import { apiPrefix } from '#start/api'
import { throttle } from '#start/limiter'
import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'

router
  .group(() => {
    router
      .group(() => {
        router
          .group(() => {
            router.get('/me', [controllers.Session, 'show'])
            router.post('/sign-up', [controllers.NewAccount, 'store'])
            router.post('/sign-in', [controllers.Session, 'store'])
            router.post('/request-reset', [controllers.PasswordResetRequests, 'store'])
            router.post('/inspect-reset', [controllers.PasswordResets, 'show'])
            router.post('/reset-password', [controllers.PasswordResets, 'update'])
            router
              .group(() => {
                router.post('/inspect', [controllers.EmailVerifications, 'show'])
                router.post('/complete', [controllers.EmailVerifications, 'update'])
              })
              .prefix('/verification')
            router
              .group(() => {
                router.post('/password-confirmation', [controllers.PasswordConfirmations, 'store'])
                router.post('/change-password', [controllers.Password, 'update'])
                router.post('/delete-account', [controllers.Account, 'destroy'])
                router.post('/verification/send', [controllers.EmailVerificationRequests, 'store'])
              })
              .use(middleware.auth({ guards: ['web'] }))
          })
          .use(middleware.accountKitAccountBlocker())
        router.post('/sign-out', [controllers.Session, 'destroy'])
      })
      .prefix('/auth')
  })
  .prefix(apiPrefix)
  .as('api')
  .use(throttle)
