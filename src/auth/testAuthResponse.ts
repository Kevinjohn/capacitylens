/** Test-only response helper: authenticated fixtures include the application session boundary. */
export function me(status: number, body: unknown): Response {
  const normalizedBody =
    body &&
    typeof body === "object" &&
    "authMode" in body &&
    (body.authMode === "password" || body.authMode === "sso") &&
    !("sessionInstanceId" in body)
      ? { ...body, sessionInstanceId: "A".repeat(43) }
      : body;
  return new Response(JSON.stringify(normalizedBody), {
    status,
    headers: { "content-type": "application/json" },
  });
}
