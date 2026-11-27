import router from '@adonisjs/core/services/router'
import { apiPrefix } from '#start/api'
import { throttle } from '#start/limiter'
import { asCompanyMember, asCompanyMemberOnly } from '#start/route_middleware'
import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'

// Company-scoped member administration and privacy routes.
router
  .group(() => {
    router
      .group(() => {
        router.get('/members', [controllers.Members, 'index']).use(asCompanyMemberOnly())
        router
          .group(() => {
            router.put('/member-sign-in-tracking', [controllers.MemberSignInTracking, 'update'])
            router.patch('/members/:userId', [controllers.Members, 'update'])
            router.patch('/members/:userId/status', [controllers.MemberStatus, 'update'])
          })
          .use(asCompanyMember())
      })
      .prefix('/companies/:companyId')
      .use(middleware.accountGate({ access: 'admitted' }))
  })
  .prefix(apiPrefix)
  .as('api')
  .use(throttle)
