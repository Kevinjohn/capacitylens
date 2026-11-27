import type { HttpContext } from '@adonisjs/core/http'
import app from '@adonisjs/core/services/app'
import type { MasqueradeRuntime, ResolvedContext } from '@kevinjohn/adonisjs-masquerade'

type Admission = { resolve(ctx: HttpContext): Promise<ResolvedContext> }

/** Marks the wrapped runtime, so a later call finds its seam on the container binding itself. */
const seamKey = Symbol('masquerade admission seam')

/**
 * The Masquerade package's request admission as one replaceable `resolve`, so a test can pause or
 * fail a member route after the package admitted it and before the handler runs. `resolve` runs
 * once per request; restore the original when the test ends.
 */
export async function masqueradeAdmission(): Promise<Admission> {
  const runtime = await app.container.make('masquerade.runtime')
  const existing = (runtime as Partial<Record<typeof seamKey, Admission>>)[seamKey]
  if (existing) return existing
  const admission: Admission = {
    resolve: async (ctx) => {
      const admitted = await runtime.admit(ctx)
      return admitted.context
    },
  }
  const resolved = new WeakMap<HttpContext, Promise<ResolvedContext>>()
  // The runtime is an abstract class type, so a spread would not carry its methods into the type.
  const wrapped: MasqueradeRuntime & Record<typeof seamKey, Admission> = {
    [seamKey]: admission,
    service: runtime.service,
    config: runtime.config,
    effectiveGuardName: runtime.effectiveGuardName,
    effectiveGuardNames: runtime.effectiveGuardNames,
    selectGuard: (ctx) => runtime.selectGuard(ctx),
    activeMode: (owner) => runtime.activeMode(owner),
    actor: (ctx) => runtime.actor(ctx),
    admit: async (ctx: HttpContext) => {
      let pending = resolved.get(ctx)
      if (!pending) {
        pending = admission.resolve(ctx)
        resolved.set(ctx, pending)
      }
      await pending
      return runtime.admit(ctx)
    },
  }
  app.container.bindValue('masquerade.runtime', Object.freeze(wrapped))
  return admission
}
