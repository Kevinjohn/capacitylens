import type { HttpContext } from '@adonisjs/core/http';
import type { ResolvedContext } from 'adonisjs-masquerade';

const contexts = new WeakMap<HttpContext, ResolvedContext>();

export function captureMasqueradeContext(ctx: HttpContext, context: ResolvedContext) {
  contexts.set(ctx, context);
}

export function capturedMasqueradeContext(ctx: HttpContext) {
  return contexts.get(ctx);
}
