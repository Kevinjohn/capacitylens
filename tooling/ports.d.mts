/**
 * Names a service port assigned to each port lane.
 */
export type PortLanePortName =
  | 'web'
  | 'dbWeb'
  | 'authWeb'
  | 'dbApi'
  | 'authApi'
  | 'testHttp'
  | 'preview'
  | 'docsDev'
  | 'docsPreview'

/**
 * Number of concurrent port lanes.
 */
export const PORT_LANE_CEILING: number
/**
 * Environment variable containing the selected port lane.
 */
export const PORT_LANE_ENVIRONMENT_KEY: string
/**
 * Environment variable containing the run's worker share.
 */
export const SHARE_ENVIRONMENT_KEY: string
/**
 * Validates and returns a port lane number.
 * @throws When the port lane is outside the supported range.
 */
export function assertPortLane(portLane: number): number
/**
 * Returns the frozen service-port map for a port lane.
 * @throws When the port lane is outside the supported range.
 */
export function portsForPortLane(portLane: number): Readonly<Record<PortLanePortName, number>>
/**
 * Reads the port lane from the supplied environment, defaulting an unset or empty value to port lane 0.
 * @throws When a non-empty configured port lane is not an integer from 0 to PORT_LANE_CEILING - 1.
 */
export function resolvePortLane(environment?: Readonly<Record<string, string | undefined>>): number
/**
 * Returns service ports for the selected environment port lane.
 * @throws When a configured port lane is outside the supported range.
 */
export function ports(
  environment?: Readonly<Record<string, string | undefined>>
): Readonly<Record<PortLanePortName, number>>
/**
 * Returns the configured or default worker share.
 * @throws When the configured share is not a positive integer.
 */
export function testShare(environment?: Readonly<Record<string, string | undefined>>): number
/**
 * Returns the worker share available to a single run.
 */
export function soloShare(cores?: number): number
/**
 * Returns the maximum worker share allowed for one run.
 */
export function reservationCeiling(cores?: number): number

/** First isolated worker port. */
export const WORKER_BASE: number
/** Worker slots per port lane. */
export const WORKER_SLOTS_PER_PORT_LANE: number
/** Returns an isolated worker API port; invalid port lane or slot throws RangeError. */
export function workerPorts(portLane: number, slot: number): Readonly<{ api: number }>
