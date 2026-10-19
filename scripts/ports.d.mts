/**
 * Names a service port assigned to each lane.
 */
export type LanePortName =
  "web" | "dbWeb" | "authWeb" | "dbApi" | "authApi" | "testHttp" | "preview" | "docsDev" | "docsPreview";

/**
 * Number of concurrent port lanes.
 */
export const LANE_CEILING: number;
/**
 * Environment variable containing the selected port lane.
 */
export const LANE_ENVIRONMENT_KEY: string;
/**
 * Environment variable containing the run's worker share.
 */
export const SHARE_ENVIRONMENT_KEY: string;
/**
 * Repository path of the fixed access-lab port lock.
 */
export const FIXED_PORTS_LOCK_FILE: string;
/**
 * Fixed loopback ports reserved for the access lab.
 */
export const ACCESS_LAB_FIXED_PORTS: Readonly<Record<"web" | "api", number>>;

/**
 * Validates and returns a lane number.
 * @throws When the lane is outside the supported range.
 */
export function assertLane(lane: number): number;
/**
 * Returns the frozen service-port map for a lane.
 * @throws When the lane is outside the supported range.
 */
export function portsForLane(lane: number): Readonly<Record<LanePortName, number>>;
/**
 * Reads the lane from the supplied environment, defaulting an unset or empty value to lane 0.
 * @throws When a non-empty configured lane is not an integer from 0 to LANE_CEILING - 1.
 */
export function resolveLane(environment?: Readonly<Record<string, string | undefined>>): number;
/**
 * Returns service ports for the selected environment lane.
 * @throws When a configured lane is outside the supported range.
 */
export function ports(
  environment?: Readonly<Record<string, string | undefined>>,
): Readonly<Record<LanePortName, number>>;
/**
 * Returns the configured or default worker share.
 * @throws When the configured share is not a positive integer.
 */
export function testShare(environment?: Readonly<Record<string, string | undefined>>): number;
/**
 * Returns the worker share available to a single run.
 */
export function soloShare(cores?: number): number;
/**
 * Returns the maximum worker share allowed for one run.
 */
export function reservationCeiling(cores?: number): number;
