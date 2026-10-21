import { NEUTRAL_COLOR } from "./colorPalette";
import { calculateRelativeLuminance, normalizeLinearChannel, parseRgb } from "./colorPrimitives";
import type { RgbChannels } from "./colorPrimitives";

const DARK_INK = "#1c2230";
const LIGHT_INK = "#ffffff";

/** WCAG contrast ratio of two hex colours; 1 when either cannot be parsed. Pure. */
export function contrastRatio(hexA: string, hexB: string): number {
  const leftLuminance = calculateRelativeLuminance(hexA);
  const rightLuminance = calculateRelativeLuminance(hexB);
  if (leftLuminance === null || rightLuminance === null) return 1;
  const higherLuminance = Math.max(leftLuminance, rightLuminance);
  const lowerLuminance = Math.min(leftLuminance, rightLuminance);
  return (higherLuminance + 0.05) / (lowerLuminance + 0.05);
}

/** Pick whichever of white / dark ink has the higher WCAG contrast on `hex`. */
export function readableTextColor(hex: string): string {
  // Load-bearing guard, not redundant with contrastRatio: an unparseable `hex` makes both ratios
  // below the documented "no contrast info" value of 1, which would tie and hand the answer to
  // white ink. An unreadable colour must fall back to dark ink.
  if (calculateRelativeLuminance(hex) === null) return DARK_INK;
  return contrastRatio(hex, LIGHT_INK) >= contrastRatio(hex, DARK_INK) ? LIGHT_INK : DARK_INK;
}

const AA_NORMAL = 4.5;

// Quantize candidate channels exactly as output hex serialization does so the contrast test scores the emitted colour.
const channelByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

const toHex = (redChannel: number, greenChannel: number, blueChannel: number) =>
  "#" +
  [redChannel, greenChannel, blueChannel].map((value) => channelByte(value).toString(16).padStart(2, "0")).join("");

function contrastForChannels(channels: RgbChannels, inkLuminance: number): number {
  const luminance =
    0.2126 * normalizeLinearChannel(channelByte(channels.red)) +
    0.7152 * normalizeLinearChannel(channelByte(channels.green)) +
    0.0722 * normalizeLinearChannel(channelByte(channels.blue));
  return (Math.max(luminance, inkLuminance) + 0.05) / (Math.min(luminance, inkLuminance) + 0.05);
}

function nudgeChannels(channels: RgbChannels, darken: boolean): void {
  if (darken) {
    channels.red *= 0.92;
    channels.green *= 0.92;
    channels.blue *= 0.92;
    return;
  }
  channels.red += (255 - channels.red) * 0.12;
  channels.green += (255 - channels.green) * 0.12;
  channels.blue += (255 - channels.blue) * 0.12;
}

/**
 * Bar label legibility: many mid-tone colours give neither white nor dark ink a
 * 4.5:1 ratio (e.g. the default indigo/blue/purple all land ~4.0–4.5). Keep the
 * chosen hue but nudge its lightness (darker under white ink, lighter under dark
 * ink) until the label clears WCAG AA. Returns the adjusted background + its ink.
 */
export function resolveAccessibleBarColors(hex: string): { bg: string; ink: string } {
  const channels = parseRgb(hex);
  const ink = readableTextColor(hex);
  if (!channels) return { bg: NEUTRAL_COLOR, ink: readableTextColor(NEUTRAL_COLOR) };
  const nudgedChannels = { ...channels };
  const darken = ink === LIGHT_INK;
  // The ink is fixed through the loop, so linearize it once.
  const inkLuminance = calculateRelativeLuminance(ink) ?? 0;
  // Score quantized channels so the contrast check matches the emitted hex colour.
  let nudged = false;
  for (let i = 0; i < 30 && contrastForChannels(nudgedChannels, inkLuminance) < AA_NORMAL; i++) {
    nudgeChannels(nudgedChannels, darken);
    nudged = true;
  }
  // Return an already-legible input verbatim to preserve its casing and whitespace.
  return {
    bg: nudged ? toHex(nudgedChannels.red, nudgedChannels.green, nudgedChannels.blue) : hex,
    ink,
  };
}

/** Compatibility alias for the published shared contract. */
export { resolveAccessibleBarColors as ensureBarColors };
