import router from '@adonisjs/core/services/router'
import { apiPrefix } from '#start/api'
import { throttle } from '#start/limiter'
import { sensitive } from '@kevinjohn/adonisjs-masquerade/http'
import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'

// Company-scoped member administration and privacy routes.
router
  .group(() => {
    router
      .group(() => {
        router.get('/members', [controllers.Members, 'index']).use(sensitive())
        router.put('/member-sign-in-tracking', [controllers.MemberSignInTracking, 'update'])
        router.patch('/members/:userId', [controllers.Members, 'update'])
        router.patch('/members/:userId/status', [controllers.MemberStatus, 'update'])
      })
      .prefix('/companies/:companyId')
      .use([
        middleware.accountGate({ access: 'admitted' }),
        middleware.auth({ guards: ['web_effective'] }),
        middleware.companyScope(),
      ])
  })
  .prefix(apiPrefix)
  .as('api')
  .use(throttle)
