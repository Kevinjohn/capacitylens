import type { HttpContext } from '@adonisjs/core/http';
import type { NextFn } from '@adonisjs/core/types/http';
import { masqueradeContext } from '@kevinjohn/adonisjs-masquerade/http';

/**
 * The Masquerade package's route policy: on a member route it admits the view-as mode, requires
 * the captured context on a write, and refuses writes and sensitive routes while a mode is active.
 */
export default class MasqueradeContextMiddleware {
  handle(ctx: HttpContext, next: NextFn) {
    return masqueradeContext(ctx, next);
  }
}
