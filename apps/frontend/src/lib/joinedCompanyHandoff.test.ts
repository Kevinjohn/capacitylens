import { afterEach, describe, expect, it } from 'vitest';
import { clearJoinedCompanyHandoff, readJoinedCompanyHandoff } from './joinedCompanyHandoff';

const realLocation = window.location;

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: realLocation,
  });
});

describe('joined company handoff', () => {
  it('ignores missing and empty destinations', () => {
    expect(readJoinedCompanyHandoff('')).toBeNull();
    expect(readJoinedCompanyHandoff('?joinedCompany=')).toBeNull();
    expect(readJoinedCompanyHandoff('?other=1')).toBeNull();
  });

  it('returns the destination unchanged when present and non-empty', () => {
    expect(readJoinedCompanyHandoff('?joinedCompany=company-1')).toBe('company-1');
    expect(readJoinedCompanyHandoff('?joinedCompany=company-1&other=1')).toBe('company-1');
  });

  it('removes only the one-use destination from a combined query', () => {
    expect(clearJoinedCompanyHandoff('?tab=security&joinedCompany=company-1&view=archived')).toBe(
      '?tab=security&view=archived',
    );
    expect(clearJoinedCompanyHandoff('?joinedCompany=company-1')).toBe('');
  });
});
