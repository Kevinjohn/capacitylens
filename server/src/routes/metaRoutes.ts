import type { FastifyInstance } from "fastify";

/** Dependencies for the authenticated installation initialization probe. */
export interface MetaRouteDependencies {
  isInitialized: () => boolean;
}

/** Registers the initialization probe without exposing tenant data. */
export function registerMetaRoutes(app: FastifyInstance, dependencies: MetaRouteDependencies): void {
  // Initialization survives deliberate data deletion so startup never resurrects demo rows.
  // The authenticated probe exposes only this installation-level boolean, not tenant or identity facts.
  app.get("/api/meta", (_req, reply) => reply.code(200).send({ hasData: dependencies.isInitialized() }));
}
