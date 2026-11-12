import { afterEach, describe, expect, it } from 'vitest';
import { clearJoinedAccountHandoff, readJoinedAccountHandoff } from './joinedAccountHandoff';

const realLocation = window.location;

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: realLocation,
  });
});

describe('joined account handoff', () => {
  it('ignores missing and empty destinations', () => {
    expect(readJoinedAccountHandoff('')).toBeNull();
    expect(readJoinedAccountHandoff('?joinedAccount=')).toBeNull();
    expect(readJoinedAccountHandoff('?other=1')).toBeNull();
  });

  it('returns the destination unchanged when present and non-empty', () => {
    expect(readJoinedAccountHandoff('?joinedAccount=account-1')).toBe('account-1');
    expect(readJoinedAccountHandoff('?joinedAccount=account-1&other=1')).toBe('account-1');
  });

  it('removes only the one-use destination from a combined query', () => {
    expect(clearJoinedAccountHandoff('?tab=security&joinedAccount=account-1&view=archived')).toBe(
      '?tab=security&view=archived',
    );
    expect(clearJoinedAccountHandoff('?joinedAccount=account-1')).toBe('');
  });
});
