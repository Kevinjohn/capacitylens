import router from '@adonisjs/core/services/router'
import { apiPrefix } from '#start/api'
import { throttle } from '#start/limiter'
import { sensitive } from '@kevinjohn/adonisjs-masquerade/http'
import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'

// Invitation, admission and member resource routes.
router
  .group(() => {
    router
      .group(() => {
        router.post('/invitations', [controllers.Invitations, 'store'])
        router
          .group(() => {
            router
              .resource('invitations', controllers.Invitations)
              .apiOnly()
              .only(['index', 'destroy'])
              .use('index', sensitive())
            router.post('/invitations/:id/resend', [controllers.InvitationDeliveries, 'store'])
          })
          .prefix('/companies/:companyId')
          .use(middleware.companyScope())
      })
      .use([
        middleware.accountGate({ access: 'admitted' }),
        middleware.auth({ guards: ['web_effective'] }),
      ])
    router
      .group(() => {
        router.get('/preview', [controllers.InvitationLinks, 'show'])
        router.post('/sign-up', [controllers.InvitationAcceptances, 'store'])
      })
      .prefix('/invitations/:token')
      .where('token', /^[^/\s]+$/)
      .use(middleware.accountKitAccountBlocker())

    router
      .group(() => {
        router
          .group(() => {
            router.get('/', [controllers.Admission, 'show']).use(sensitive())
            router.post('/request', [controllers.AdmissionRequests, 'store'])
            router.get('/requests', [controllers.AdmissionRequests, 'index']).use(sensitive())
            router
              .group(() => {
                router.post('/approve', [controllers.AdmissionApprovals, 'store'])
                router.post('/reject', [controllers.AdmissionRejections, 'store'])
                router.post('/revoke', [controllers.AdmissionRevocations, 'store'])
              })
              .prefix('/:userId')
          })
          .use([
            middleware.accountGate({ access: 'limited' }),
            middleware.auth({ guards: ['web_effective'] }),
          ])
        router
          .post('/complete', [controllers.Memberships, 'store'])
          .use([
            middleware.accountGate({ access: 'admitted' }),
            middleware.auth({ guards: ['web_effective'] }),
          ])
      })
      .prefix('/admission')

    router
      .group(() => {
        router.put('/', [controllers.MemberResourceLink, 'update'])
        router.delete('/', [controllers.MemberResourceLink, 'destroy'])
      })
      .prefix('/companies/:companyId/members/:userId/resource-link')
      .use([
        middleware.accountGate({ access: 'admitted' }),
        middleware.auth({ guards: ['web_effective'] }),
        middleware.companyScope(),
      ])
  })
  .prefix(apiPrefix)
  .as('api')
  .use(throttle)
