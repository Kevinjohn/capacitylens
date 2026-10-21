function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function hasSqliteConstraintCode(error: object): boolean {
  return (
    ("errcode" in error && (error.errcode === 19 || error.errcode === 2067)) ||
    ("code" in error && typeof error.code === "string" && error.code.startsWith("SQLITE_CONSTRAINT"))
  );
}

/** Recognizes a uniqueness conflict between federated account coordinates. */
export function isFederatedAccountCoordinateConstraint(error: unknown): boolean {
  if (!isObject(error) || !hasSqliteConstraintCode(error) || !("message" in error)) return false;

  return (
    typeof error.message === "string" &&
    error.message.includes("account.providerId") &&
    (error.message.includes("account.accountId") || error.message.includes("account.userId"))
  );
}
