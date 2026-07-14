export function parsePort(value, fallback, name) {
  const raw = value ?? fallback
  const port = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError(`${name} must be an integer from 1 to 65535; received ${JSON.stringify(raw)}.`)
  }
  return port
}
