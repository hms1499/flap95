import { describe, it, expect } from 'vitest';
import { decideWinner } from './oracle';

describe('decideWinner', () => {
  it('creator wins on higher score', () => expect(decideWinner(5, 3)).toBe('creator'));
  it('acceptor wins on higher score', () => expect(decideWinner(2, 3)).toBe('acceptor'));
  it('equal scores tie (including 0-0)', () => {
    expect(decideWinner(4, 4)).toBe('tie');
    expect(decideWinner(0, 0)).toBe('tie');
  });
});
