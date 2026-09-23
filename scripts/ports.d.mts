export type LanePortName = "web" | "dbWeb" | "authWeb" | "dbApi" | "authApi" | "preview" | "docsDev" | "docsPreview";

export const LANE_CEILING: number;
export const LANE_ENVIRONMENT_KEY: string;
export const SHARE_ENVIRONMENT_KEY: string;
export const FIXED_PORTS_LOCK_FILE: string;
export const ACCESS_LAB_FIXED_PORTS: Readonly<Record<"web" | "api", number>>;

export function assertLane(lane: number): number;
export function portsForLane(lane: number): Readonly<Record<LanePortName, number>>;
export function resolveLane(environment?: Readonly<Record<string, string | undefined>>): number;
export function ports(
  environment?: Readonly<Record<string, string | undefined>>,
): Readonly<Record<LanePortName, number>>;
export function testShare(environment?: Readonly<Record<string, string | undefined>>): number;
export function soloShare(cores?: number): number;
export function reservationCeiling(cores?: number): number;
