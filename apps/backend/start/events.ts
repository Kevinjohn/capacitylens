import emitter from '@adonisjs/core/services/emitter';
import { listeners } from '#generated/listeners';

emitter.on('queued:mail:error', [listeners.ReportQueuedMailError]);
