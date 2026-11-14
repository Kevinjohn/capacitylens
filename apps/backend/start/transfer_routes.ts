import router from '@adonisjs/core/services/router';
import { asMember } from '#start/route_guards';

const TransferController = () => import('#controllers/transfer_controller');

/** Registers the transfer controller endpoints. */
export function registerTransferRoutes() {
  router
    .post('/api/transfer/preview', [TransferController, 'preview'])
    .as('api.transfer.preview')
    .use(asMember());
  router
    .post('/api/transfer/apply', [TransferController, 'apply'])
    .as('api.transfer.apply')
    .use(asMember());
}
