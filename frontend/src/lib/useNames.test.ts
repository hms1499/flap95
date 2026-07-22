import { describe, it, expect } from 'vitest';
import { displayName } from './useNames';

describe('displayName', () => {
  const addr = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
  it('prefers the profile name, looked up lowercase', () => {
    expect(displayName({ [addr.toLowerCase()]: 'Huy' }, addr)).toBe('Huy');
  });
  it('falls back to the shortened address', () => {
    expect(displayName({}, addr)).toBe('0x709979…');
  });
});
