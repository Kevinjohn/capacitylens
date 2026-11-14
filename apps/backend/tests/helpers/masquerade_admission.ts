import type { HttpContext } from '@adonisjs/core/http';
import app from '@adonisjs/core/services/app';
import type { ResolvedContext } from '@kevinjohn/adonisjs-masquerade';

type Admission = { resolve(ctx: HttpContext): Promise<ResolvedContext> };

let seam: Admission | undefined;

/**
 * The Masquerade package's request admission as one replaceable `resolve`, so a test can pause or
 * fail a member route after the package admitted it and before the handler runs. `resolve` runs
 * once per request; restore the original when the test ends.
 */
export async function masqueradeAdmission(): Promise<Admission> {
  if (seam) return seam;
  const runtime = await app.container.make('masquerade.runtime');
  const admission: Admission = {
    resolve: async (ctx) => {
      const admitted = await runtime.admit(ctx);
      return admitted.context;
    },
  };
  const resolved = new WeakMap<HttpContext, Promise<ResolvedContext>>();
  app.container.bindValue(
    'masquerade.runtime',
    Object.freeze({
      ...runtime,
      admit: async (ctx: HttpContext) => {
        let pending = resolved.get(ctx);
        if (!pending) {
          pending = admission.resolve(ctx);
          resolved.set(ctx, pending);
        }
        await pending;
        return runtime.admit(ctx);
      },
    })
  );
  seam = admission;
  return admission;
}
