/** Returns the rejection for assertions that inspect Better Auth's error fields. */
export const readRejectedValue = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    // Return the expected rejection unchanged so assertions can inspect the library’s error contract.
    return error;
  }
  throw new Error("Expected promise to reject");
};

/** Reads the stable status and code fields from an unknown Better Auth API error. */
export const parseApiErrorFields = (value: unknown): { status: unknown; code: unknown } => {
  if (typeof value !== "object" || value === null || !("status" in value) || !("body" in value)) {
    throw new Error("Expected an API error object");
  }
  const { body, status } = value;
  if (typeof body !== "object" || body === null || !("code" in body)) {
    throw new Error("Expected an API error body with a code");
  }
  return { status, code: body.code };
};
