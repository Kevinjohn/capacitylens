/**
 * Builds the isolated loopback-only environment used by the access lab.
 */
export function buildAccessLabEnv(
  inherited: NodeJS.ProcessEnv,
  ports: { apiPort: number; webPort: number },
): NodeJS.ProcessEnv;
