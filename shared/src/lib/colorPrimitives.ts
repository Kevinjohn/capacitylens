const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export interface RgbChannels {
  red: number;
  green: number;
  blue: number;
}

/** Parse a six-digit hex colour into RGB channels, or return null for unsupported input. */
export function parseRgb(hex: string): RgbChannels | null {
  const normalized = hex.trim();
  if (!HEX_COLOR_RE.test(normalized)) return null;
  const body = normalized.slice(1);
  return {
    red: parseInt(body.slice(0, 2), 16),
    green: parseInt(body.slice(2, 4), 16),
    blue: parseInt(body.slice(4, 6), 16),
  };
}

/** Convert an 8-bit sRGB channel to its linear-light value for WCAG luminance. */
export function normalizeLinearChannel(channel: number): number {
  const normalizedChannel = channel / 255;
  return normalizedChannel <= 0.03928 ? normalizedChannel / 12.92 : Math.pow((normalizedChannel + 0.055) / 1.055, 2.4);
}

/** Calculate WCAG relative luminance, or return null when the hex colour is invalid. */
export function calculateRelativeLuminance(hex: string): number | null {
  const channels = parseRgb(hex);
  if (!channels) return null;
  const { red, green, blue } = channels;
  return (
    0.2126 * normalizeLinearChannel(red) +
    0.7152 * normalizeLinearChannel(green) +
    0.0722 * normalizeLinearChannel(blue)
  );
}
