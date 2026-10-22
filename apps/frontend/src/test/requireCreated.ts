import type { CreateResult } from "@/store/types";

/** Test fixtures expect an allowed create; fail loudly if a viewer guard blocked setup. */
export function requireCreated<T>(result: CreateResult<T>): T;
export function requireCreated<T>(result: Promise<CreateResult<T>>): Promise<T>;
export function requireCreated<T>(result: CreateResult<T> | Promise<CreateResult<T>>): T | Promise<T> {
  if (typeof (result as Promise<CreateResult<T>>).then === "function") {
    return (result as Promise<CreateResult<T>>).then((value) => requireCreated(value));
  }
  const created = result as CreateResult<T>;
  if (created.kind === "blocked") throw new Error("Test fixture creation was blocked.");
  return created.value;
}
