import type { CreateResult } from "../store/types";

/** Test fixtures expect an allowed create; fail loudly if a viewer guard blocked setup. */
export function requireCreated<T>(result: CreateResult<T>): T {
  if (result.kind === "blocked") throw new Error("Test fixture creation was blocked.");
  return result.value;
}
