import { describe, it, expect } from 'vitest';
import { orientResult, tickToSeconds, viewerRole, type SettledDuel } from './outcome';

const CREATOR = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa';
const ACCEPTOR = '0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb';
const STRANGER = '0xCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc';

describe('viewerRole', () => {
  it('identifies the creator regardless of address casing', () => {
    expect(viewerRole(CREATOR.toLowerCase(), CREATOR, ACCEPTOR)).toBe('creator');
    expect(viewerRole(CREATOR.toUpperCase(), CREATOR, ACCEPTOR)).toBe('creator');
  });
  it('identifies the acceptor', () => {
    expect(viewerRole(ACCEPTOR, CREATOR, ACCEPTOR)).toBe('acceptor');
  });
  it('treats an unrelated wallet as an observer', () => {
    expect(viewerRole(STRANGER, CREATOR, ACCEPTOR)).toBe('observer');
  });
  it('treats a disconnected viewer as an observer', () => {
    expect(viewerRole(undefined, CREATOR, ACCEPTOR)).toBe('observer');
  });
  it('treats an unaccepted duel as having no acceptor to match', () => {
    expect(viewerRole(STRANGER, CREATOR, null)).toBe('observer');
  });
});

describe('orientResult', () => {
  const creatorWon: SettledDuel = {
    winner: 'creator', creatorScore: 7, acceptorScore: 5,
    creatorDeathTick: 900, acceptorDeathTick: 700,
  };

  it('shows the creator their own score first', () => {
    const r = orientResult('creator', creatorWon);
    expect(r.yourScore).toBe(7);
    expect(r.theirScore).toBe(5);
    expect(r.won).toBe(true);
    expect(r.winnerSide).toBe('yours');
  });
  it('flips the board for the acceptor', () => {
    const r = orientResult('acceptor', creatorWon);
    expect(r.yourScore).toBe(5);
    expect(r.theirScore).toBe(7);
    expect(r.won).toBe(false);
    expect(r.winnerSide).toBe('theirs');
  });
  it('never congratulates an observer', () => {
    const r = orientResult('observer', creatorWon);
    expect(r.won).toBe(false);
    expect(r.observer).toBe(true);
    expect(r.yourLabel).toBe('CREATOR');
    expect(r.theirLabel).toBe('ACCEPTOR');
    // An observer still sees which side actually won.
    expect(r.winnerSide).toBe('yours');
  });
  it('labels the two players YOU and THEM', () => {
    const r = orientResult('creator', creatorWon);
    expect(r.yourLabel).toBe('YOU');
    expect(r.theirLabel).toBe('THEM');
  });

  it('reports a tie to both players with no winning side', () => {
    const tied: SettledDuel = {
      winner: 'tie', creatorScore: 4, acceptorScore: 4,
      creatorDeathTick: 900, acceptorDeathTick: 900,
    };
    for (const role of ['creator', 'acceptor'] as const) {
      const r = orientResult(role, tied);
      expect(r.tie).toBe(true);
      expect(r.won).toBe(false);
      expect(r.winnerSide).toBe('none');
    }
  });

  it('carries survival times through so a tie-broken win can be explained', () => {
    const brokenTie: SettledDuel = {
      winner: 'acceptor', creatorScore: 4, acceptorScore: 4,
      creatorDeathTick: 800, acceptorDeathTick: 900,
    };
    const r = orientResult('acceptor', brokenTie);
    expect(r.yourScore).toBe(r.theirScore);
    expect(r.yourDeathTick).toBe(900);
    expect(r.theirDeathTick).toBe(800);
    expect(r.won).toBe(true);
    expect(r.winnerSide).toBe('yours');
  });

  it('carries null survival times from a legacy duel', () => {
    const legacy: SettledDuel = {
      winner: 'creator', creatorScore: 6, acceptorScore: 2,
      creatorDeathTick: null, acceptorDeathTick: null,
    };
    const r = orientResult('creator', legacy);
    expect(r.yourDeathTick).toBeNull();
    expect(r.theirDeathTick).toBeNull();
  });
});

describe('tickToSeconds', () => {
  it('converts engine ticks to seconds at 60 ticks/s', () => {
    expect(tickToSeconds(900)).toBe('15.0');
    expect(tickToSeconds(55)).toBe('0.9');
    expect(tickToSeconds(3600)).toBe('60.0');
  });
});
