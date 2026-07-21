import { describe, it, expect } from 'vitest';
import { saveDuelSeed, loadDuelSeed, clearDuelSeed } from './duelSeedStore';

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => { m.clear(); },
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  } as Storage;
}

describe('duelSeedStore', () => {
  it('saves then loads the seed for a duel id', () => {
    const s = fakeStorage();
    saveDuelSeed(s, 10, 123456);
    expect(loadDuelSeed(s, 10)).toBe(123456);
  });
  it('returns null for a duel with no stored seed', () => {
    expect(loadDuelSeed(fakeStorage(), 99)).toBeNull();
  });
  it('keeps seeds separate per duel id', () => {
    const s = fakeStorage();
    saveDuelSeed(s, 1, 111);
    saveDuelSeed(s, 2, 222);
    expect(loadDuelSeed(s, 1)).toBe(111);
    expect(loadDuelSeed(s, 2)).toBe(222);
  });
  it('returns null for a corrupt (non-numeric) stored value', () => {
    const s = fakeStorage();
    s.setItem('flap95:duelseed:5', 'not-a-number');
    expect(loadDuelSeed(s, 5)).toBeNull();
  });
  it('clear removes the stored seed', () => {
    const s = fakeStorage();
    saveDuelSeed(s, 7, 42);
    clearDuelSeed(s, 7);
    expect(loadDuelSeed(s, 7)).toBeNull();
  });
});
