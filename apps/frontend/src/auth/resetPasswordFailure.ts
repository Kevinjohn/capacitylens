import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from "@capacitylens/shared/domain/password";
import { m } from "@/i18n";

/** Maps recognized reset failure codes to fixed user-facing recovery messages. Unknown shapes use the generic fallback; raw server text may contain route internals and must not be rendered. */
export function resolveResetPasswordFailureMessage(body: { code?: string } | null, status?: number): string {
  if (status === 404) return m.reset_err_unavailable();
  if (body === null) return m.reset_err_generic();
  if (body.code === "INVALID_TOKEN") return m.reset_err_invalid();
  if (body.code === "PASSWORD_TOO_SHORT") return m.reset_err_short({ min: MIN_PASSWORD_LENGTH });
  if (body.code === "PASSWORD_TOO_LONG") return m.reset_err_long({ max: MAX_PASSWORD_LENGTH });
  return m.reset_err_generic();
}
