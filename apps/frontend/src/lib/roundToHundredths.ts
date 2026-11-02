/** Rounds hours or days to two decimal places for display, so 7.499999 reads as 7.5. */
export const roundToHundredths = (value: number): number => Math.round(value * 100) / 100;
