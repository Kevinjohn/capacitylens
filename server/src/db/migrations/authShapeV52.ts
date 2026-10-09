import { defineMigration } from "../migrationLedger";

// Better Auth owns its tables. This version records the removal of its local second-factor
// plugin while preserving historical columns and rows in databases that already have them.
export const AUTH_SHAPE_V52_MIGRATION = defineMigration(
  52,
  "retire-local-second-factor-auth-shape",
  "better-auth-two-factor-plugin-removed:v1",
  () => undefined,
);
