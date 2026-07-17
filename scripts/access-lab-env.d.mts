export function buildAccessLabEnv(
  inherited: NodeJS.ProcessEnv,
  ports: { apiPort: number; webPort: number },
): NodeJS.ProcessEnv
