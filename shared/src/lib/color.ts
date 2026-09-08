import { isExternalResource } from "../types/entities";
import { effectiveProjectId } from "./integrity";
import type { Allocation, Client, ID, InternalColourMode, Project, Resource, Activity } from "../types/entities";

/** The single neutral grey — the bar/colour fallback AND the colour of external / 3rd-party
 *  identity (avatar, swatch, band, bars). Re-exported app-side as `NEUTRAL_COLOR` from
 *  src/lib/palette so both sides share ONE definition. */
export const NEUTRAL_COLOR = "#9ca3af";
/** Canonical user-selectable colour palette. Persisted user colours must belong to this set.
 * `NEUTRAL_COLOR` (external resources) and the Internal-client colour are deliberate system
 * exceptions and are therefore not included here. */
export const PRESET_COLORS = Object.freeze([
  "#f5bcbc",
  "#f7caba",
  "#f9d9b8",
  "#f9e6b8",
  "#f9f1b8",
  "#d9f2c0",
  "#c2f0d1",
  "#c0edf2",
  "#bed4f4",
  "#ccc0f2",
  "#e0c2f0",
  "#f4bedd",
  "#d8b397",
  "#eb7272",
  "#ef906e",
  "#f3ae6a",
  "#f3ca6a",
  "#f3e16a",
  "#aee37a",
  "#7edf9e",
  "#7adae3",
  "#76a5e7",
  "#947ae3",
  "#be7edf",
  "#e776b8",
  "#c38c61",
  "#e02727",
  "#e65621",
  "#ed841b",
  "#edae1b",
  "#edd11b",
  "#84d434",
  "#3ace6b",
  "#34c7d4",
  "#2d75da",
  "#5c34d4",
  "#9c3ace",
  "#da2d92",
  "#9e663c",
  "#9c1616",
  "#a13812",
  "#a5590d",
  "#a5780d",
  "#a5910d",
  "#59931f",
  "#248f47",
  "#1f8a93",
  "#1b4f98",
  "#3c1f93",
  "#6b248f",
  "#981b64",
  "#684327",
] as const);
const PRESET_COLOR_SET = new Set<string>(PRESET_COLORS);
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
/** Parsed RGB of every preset, precomputed ONCE alongside `PRESET_COLOR_SET`. The nearest-preset
 *  scan below runs on every persisted/imported colour, and re-parsing all 52 palette hex strings
 *  per call was pure repeated work. Index-aligned with `PRESET_COLORS`, so palette order (the
 *  deterministic tie-break) is preserved. An entry is `null` only if a palette member were not a
 *  valid 6-digit hex — unreachable (pinned by a test), but kept nullable so such an entry is
 *  SKIPPED rather than poisoning every distance with NaN. */
const PRESET_RGB: readonly (RgbChannels | null)[] = PRESET_COLORS.map((preset) => parseRgb(preset));

export function isPresetColor(value: unknown): value is string {
  return typeof value === "string" && PRESET_COLOR_SET.has(value.trim().toLowerCase());
}

/** Used by {@link snapToPresetColor} ONLY when the input can't be parsed as a 6-digit hex at
 *  all (so no "nearest" distance can even be computed) — e.g. `null`, `undefined`, `"nope"`.
 *  This is the ONE fixed colour left in the system; every *parseable* colour, however far off
 *  the palette, is snapped to its nearest preset instead — see snapToPresetColor. */
export const FALLBACK_PRESET_COLOR = "#5c34d4";

/**
 * Snap ANY colour value to the canonical `PRESET_COLORS` palette:
 *  - a value already in the palette is returned normalized (trimmed + lowercased);
 *  - any other parseable 6-digit hex is mapped to its NEAREST preset by RGB Euclidean distance
 *    (ties broken by palette order — the first minimal-distance preset wins, so the mapping is
 *    deterministic and reproducible);
 *  - an unparseable value (wrong shape, non-string, `null`/`undefined`) returns
 *    {@link FALLBACK_PRESET_COLOR}.
 *
 * This is the SINGLE mapping used by server writes, import repair, the one-time
 * `snap-legacy-account-colors` DB migration and the client store, so a given stored colour is
 * always classified IDENTICALLY on every persistence path.
 * See DECISIONS.md for the policy this implements.
 */
export function snapToPresetColor(value: unknown): string {
  if (typeof value !== "string") return FALLBACK_PRESET_COLOR;
  const normalized = value.trim().toLowerCase();
  if (PRESET_COLOR_SET.has(normalized)) return normalized;
  const channels = parseRgb(normalized);
  if (!channels) return FALLBACK_PRESET_COLOR;
  const { red: r, green: g, blue: b } = channels;
  let nearest: string = FALLBACK_PRESET_COLOR;
  let nearestDistance = Infinity;
  for (const [i, preset] of PRESET_COLORS.entries()) {
    const presetRgb = PRESET_RGB[i];
    if (!presetRgb) continue; // unreachable: every PRESET_COLORS entry is a valid 6-digit hex (pinned by a test)
    const { red: pr, green: pg, blue: pb } = presetRgb;
    // Squared Euclidean distance in RGB space — no sqrt needed since we only compare magnitudes.
    const distance = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    // Strict `<` (not `<=`) so the FIRST minimal-distance preset wins on a tie — palette order
    // is the deterministic tie-break.
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = preset;
    }
  }
  return nearest;
}

/** Id→entity maps for O(1) colour resolution. The scheduler model already builds
 *  these to position bars, so colour resolution reuses them instead of re-scanning
 *  the raw arrays once per bar. */
export interface BarColorMaps {
  activities: Map<ID, Activity>;
  projects: Map<ID, Project>;
  clients: Map<ID, Client>;
  resources: Map<ID, Resource>;
  /** Account display preference. Absent means the default neutral-grey Internal treatment. */
  internalColourMode?: InternalColourMode;
}

/** Resolve a project's displayed colour without mutating its saved palette choice. Internal-owned
 * projects are neutral grey by default; palette mode restores the stored project colour. */
export function resolveProjectColor(
  project: Project,
  client: Client | undefined,
  internalColourMode: InternalColourMode = "grey",
): string {
  return internalColourMode === "grey" && client?.builtin === true ? NEUTRAL_COLOR : project.color;
}

/** Resolve an allocation bar colour. External work is always grey. In the default Internal-grey
 * mode, `internal` activities and allocations whose effective project is Internal-owned are also
 * grey; otherwise bars use project → client → resource → neutral fallback order. */
export function resolveBarColor(allocation: Allocation, maps: BarColorMaps): string {
  const resource = maps.resources.get(allocation.resourceId);
  // External / 3rd-party work reads as a single neutral colour (an "awareness" signal),
  // overriding the usual project→client colouring so an outsourced bar never looks like one of
  // our own. See DECISIONS.md "external kind": single neutral colour.
  if (resource && isExternalResource(resource)) return NEUTRAL_COLOR;
  const activity = maps.activities.get(allocation.activityId);
  const projectId = effectiveProjectId(allocation, activity ?? {});
  const project = projectId ? maps.projects.get(projectId) : undefined;
  const client = project ? maps.clients.get(project.clientId) : undefined;
  const internalColourMode = maps.internalColourMode ?? "grey";
  if (internalColourMode === "grey" && (activity?.kind === "internal" || client?.builtin === true))
    return NEUTRAL_COLOR;
  if (project?.color) return project.color;
  if (client?.color) return client.color;

  return resource?.color ?? NEUTRAL_COLOR;
}

const DARK_INK = "#1c2230";
const LIGHT_INK = "#ffffff";

// WCAG relative luminance: linearise each sRGB channel before weighting.
function normalizeLinearChannel(channel: number): number {
  const normalizedChannel = channel / 255;
  return normalizedChannel <= 0.03928 ? normalizedChannel / 12.92 : Math.pow((normalizedChannel + 0.055) / 1.055, 2.4);
}

interface RgbChannels {
  red: number;
  green: number;
  blue: number;
}

function parseRgb(hex: string): RgbChannels | null {
  const normalized = hex.trim();
  if (!HEX_COLOR_RE.test(normalized)) return null;
  const body = normalized.slice(1);
  return {
    red: parseInt(body.slice(0, 2), 16),
    green: parseInt(body.slice(2, 4), 16),
    blue: parseInt(body.slice(4, 6), 16),
  };
}

function calculateRelativeLuminance(hex: string): number | null {
  const channels = parseRgb(hex);
  if (!channels) return null;
  const { red: r, green: g, blue: b } = channels;
  return 0.2126 * normalizeLinearChannel(r) + 0.7152 * normalizeLinearChannel(g) + 0.0722 * normalizeLinearChannel(b);
}

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
  // Load-bearing guard, NOT redundant with contrastRatio: an unparseable `hex` makes BOTH ratios
  // below the documented "no contrast info" value of 1, which would tie and hand the answer to
  // white ink. An unreadable colour must fall back to dark ink.
  if (calculateRelativeLuminance(hex) === null) return DARK_INK;
  return contrastRatio(hex, LIGHT_INK) >= contrastRatio(hex, DARK_INK) ? LIGHT_INK : DARK_INK;
}

const AA_NORMAL = 4.5;

/** The exact channel quantisation `toHex` writes (and therefore the value a later re-parse of that
 *  hex reads back). Shared so the nudge loop below can score a candidate from its live float
 *  channels WITHOUT round-tripping through a hex string, yet score the identical byte values. */
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
 * chosen hue but nudge its lightness — darker under white ink, lighter under dark
 * ink — until the label clears WCAG AA. Returns the adjusted background + its ink.
 */
export function ensureBarColors(hex: string): { bg: string; ink: string } {
  const channels = parseRgb(hex);
  const ink = readableTextColor(hex);
  if (!channels) return { bg: NEUTRAL_COLOR, ink: readableTextColor(NEUTRAL_COLOR) };
  const nudgedChannels = { ...channels };
  const darken = ink === LIGHT_INK;
  // The ink never changes inside the loop, so linearise it ONCE. Previously each iteration
  // re-formatted the candidate to hex and re-parsed BOTH it and the ink through contrastRatio;
  // now only the settled colour is formatted, after the loop.
  const inkLuminance = calculateRelativeLuminance(ink) ?? 0;
  // Score from the quantised bytes (`channelByte`), i.e. exactly the channels a re-parse of
  // `toHex(...)` would yield — so the loop stops on precisely the same iteration as before.
  let nudged = false;
  for (let i = 0; i < 30 && contrastForChannels(nudgedChannels, inkLuminance) < AA_NORMAL; i++) {
    nudgeChannels(nudgedChannels, darken);
    nudged = true;
  }
  // An already-legible colour is returned VERBATIM (the caller's casing/whitespace survives),
  // matching the previous `let bg = hex` that only the loop ever overwrote.
  return {
    bg: nudged ? toHex(nudgedChannels.red, nudgedChannels.green, nudgedChannels.blue) : hex,
    ink,
  };
}
