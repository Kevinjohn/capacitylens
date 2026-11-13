import { describe, expect, it } from 'vitest';
import { parseReportPhaseName } from '../../../scripts/playwrightServerScope';
import { E2E_RUN_PRESETS, resolvePlaywrightRunMode } from '../../../scripts/playwrightRunMode.mjs';

describe('Playwright server scope', () => {
  it.each(Object.entries(E2E_RUN_PRESETS))(
    "keeps the %s preset's projects and server profile aligned",
    (_name, preset) => {
      const mode = resolvePlaywrightRunMode(preset.environment);
      expect(mode.projects).toEqual(
        preset.projects.length > 0 ? preset.projects : ['chromium', 'auth-backed'],
      );
      expect(mode.serverProfile).toBe(preset === E2E_RUN_PRESETS.standard ? 'standard' : 'workers');
    },
  );

  it('selects one engine and rejects contradictory browser modes', () => {
    expect(resolvePlaywrightRunMode({ CAPACITYLENS_WEBKIT_ONLY: '1' })).toEqual({
      projects: ['webkit'],
      serverProfile: 'workers',
    });
    expect(() =>
      resolvePlaywrightRunMode({ CAPACITYLENS_WEBKIT_ONLY: '1', CAPACITYLENS_FIREFOX_ONLY: '1' }),
    ).toThrow(/cannot be combined|mutually exclusive/);
  });

  it('uses a non-empty report phase and rejects lossy or traversal-shaped aliases', () => {
    expect(parseReportPhaseName(undefined)).toBe('default');
    expect(parseReportPhaseName('')).toBe('default');
    expect(parseReportPhaseName('chromium-server')).toBe('chromium-server');
    expect(() => parseReportPhaseName('///')).toThrow(/letters, numbers, underscores and hyphens/);
    expect(() => parseReportPhaseName('webkit/1')).toThrow(
      /letters, numbers, underscores and hyphens/,
    );
  });
});
