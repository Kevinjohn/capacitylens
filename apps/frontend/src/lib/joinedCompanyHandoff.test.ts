import { afterEach, describe, expect, it } from 'vitest';
import { clearJoinedCompanyHandoff, readJoinedCompanyHandoff } from './joinedCompanyHandoff';

const realLocation = window.location;

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: realLocation,
  });
});

describe('joined account handoff', () => {
  it('ignores missing and empty destinations', () => {
    expect(readJoinedCompanyHandoff('')).toBeNull();
    expect(readJoinedCompanyHandoff('?joinedAccount=')).toBeNull();
    expect(readJoinedCompanyHandoff('?other=1')).toBeNull();
  });

  it('returns the destination unchanged when present and non-empty', () => {
    expect(readJoinedCompanyHandoff('?joinedAccount=account-1')).toBe('account-1');
    expect(readJoinedCompanyHandoff('?joinedAccount=account-1&other=1')).toBe('account-1');
  });

  it('removes only the one-use destination from a combined query', () => {
    expect(clearJoinedCompanyHandoff('?tab=security&joinedAccount=account-1&view=archived')).toBe(
      '?tab=security&view=archived',
    );
    expect(clearJoinedCompanyHandoff('?joinedAccount=account-1')).toBe('');
  });
});
