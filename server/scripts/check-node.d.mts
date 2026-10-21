/** Returns whether the exact runtime version is admitted for server execution. */
export declare function supportsNodeVersion(version: string): boolean;
/** Refuses an unadmitted runtime before the caller can read or write application data. */
export declare function assertSupportedNodeVersion(version?: string): void;
