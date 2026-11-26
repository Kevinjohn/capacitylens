import router from '@adonisjs/core/services/router';
import { throttle } from '#start/limiter';
import { asOwnAccount } from '#start/route_middleware';
import { controllers } from '#generated/controllers';

router
  .group(() => {
    router
      .group(() => {
        router
          .group(() => {
            router.get('/me', [controllers.Session, 'show']);
            router.post('/sign-up', [controllers.NewAccount, 'store']);
            router.post('/sign-in', [controllers.Session, 'store']);
            router.post('/password-confirmation', [controllers.PasswordConfirmations, 'store']);
            router.post('/request-reset', [controllers.PasswordResetRequests, 'store']);
            router.post('/inspect-reset', [controllers.PasswordResets, 'show']);
            router.post('/reset-password', [controllers.PasswordResets, 'update']);
            router.post('/change-password', [controllers.Password, 'update']);
            router.post('/delete-account', [controllers.Account, 'destroy']);
            router
              .group(() => {
                router.post('/send', [controllers.EmailVerificationRequests, 'store']);
                router.post('/inspect', [controllers.EmailVerifications, 'show']);
                router.post('/complete', [controllers.EmailVerifications, 'update']);
              })
              .prefix('/verification');
          })
          .use(asOwnAccount());
        router.post('/sign-out', [controllers.Session, 'destroy']);
      })
      .prefix('/auth');
  })
  .prefix('/api')
  .as('api')
  .use(throttle);
