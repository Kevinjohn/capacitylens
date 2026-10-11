/**
 * Parses a provided port and uses the fallback only when value is nullish.
 * @param fallback - A TCP port from 1 through 65535, used only for nullish input.
 * @throws When the selected value is not an integer from 1 through 65535.
 */
export function parsePort(value: string | number | undefined, fallback: number, name: string): number;
