import { describe, it, expect, vi, beforeEach } from 'vitest';

// The store is mocked so these tests never touch Neon — localhost shares one
// database with production. `topScores` must be mocked too even though these
// tests never call it: the route module's GET handler imports it, and a mock
// factory that omits an imported name fails the import itself.
const upsertBest = vi.fn();
vi.mock('@/lib/profileStore', () => ({
  upsertBest: (a: string, s: number) => upsertBest(a, s),
  topScores: async () => [],
}));

process.env.SEED_SECRET = 'test-secret';

const { POST } = await import('./route');
const { issueSeedToken } = await import('@/lib/seedToken');
const { verifyRun } = await import('@/engine/verify');

const ADDRESS = '0x5028f26d8c3c0b3d88ab730ef98fef8f4d2f97f9';
const SEED = 12345;
// An empty tap list is a real, verifiable run: the bird falls and dies.
const TAPS: number[] = [];
const RUN = verifyRun(SEED, TAPS);
if (!RUN.ok) throw new Error('fixture run must verify');

// A second fixture, found by searching this deterministic engine: it survives
// 637 ticks (~10.6s) and scores 7.
//
// The wall-clock floor cannot be exercised with the empty-tap run above. That
// one dies at tick 55, about 0.9 seconds, which is BELOW SUBMIT_SLACK_MS — so
// no submission of it is ever "too fast" and the floor can never fire. Any run
// used to test the floor must last comfortably longer than the slack.
const LONG_TAPS = [
  0, 5, 9, 13, 17, 21, 44, 48, 52, 56, 60, 64, 121, 194, 264, 295,
  302, 306, 310, 314, 318, 322, 360, 418, 478, 484, 493, 559, 565,
];
const LONG_RUN = verifyRun(SEED, LONG_TAPS);
if (!LONG_RUN.ok) throw new Error('long fixture run must verify');
// Guard the premise rather than assuming it: if an engine change ever shortens
// this run below the slack, fail here with a clear reason instead of leaving a
// test that silently proves nothing.
if (LONG_RUN.deathTick < 200) throw new Error('long fixture no longer outlives the slack');

function post(body: unknown): Promise<Response> {
  return POST(new Request('http://test/api/practice', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}

/** A submission that arrives long enough after the seed to clear the wall-clock floor. */
function validBody(overrides: Record<string, unknown> = {}) {
  const issuedAt = Date.now() - 120_000;
  return {
    address: ADDRESS, seed: SEED, taps: TAPS,
    token: issueSeedToken(SEED, issuedAt, 'test-secret'),
    ...overrides,
  };
}

beforeEach(() => upsertBest.mockReset());

describe('POST /api/practice', () => {
  it('accepts a valid run and stores the score the server computed', async () => {
    const res = await post(validBody());
    expect(res.status).toBe(200);
    expect(upsertBest).toHaveBeenCalledWith(ADDRESS.toLowerCase(), RUN.score);
  });

  it('needs no signature and no profile — a nameless wallet can score', async () => {
    const body = validBody();
    expect('signature' in body).toBe(false);
    expect((await post(body)).status).toBe(200);
  });

  it('rejects a forged token before replaying anything', async () => {
    const res = await post(validBody({ token: 'forged.token' }));
    expect(res.status).toBe(401);
    expect(upsertBest).not.toHaveBeenCalled();
  });

  it('rejects a token whose seed does not match the submitted seed', async () => {
    // Otherwise a valid token could carry any seed the client preferred.
    const res = await post(validBody({ seed: SEED + 1 }));
    expect(res.status).toBe(401);
    expect(upsertBest).not.toHaveBeenCalled();
  });

  it('rejects an expired token', async () => {
    const stale = issueSeedToken(SEED, Date.now() - 700_000, 'test-secret');
    const res = await post(validBody({ token: stale }));
    expect(res.status).toBe(401);
    expect(upsertBest).not.toHaveBeenCalled();
  });

  it('rejects a run that could not have been played in the elapsed time', async () => {
    // 10.6 seconds of play cannot arrive milliseconds after the seed was issued.
    const justIssued = issueSeedToken(SEED, Date.now(), 'test-secret');
    const res = await post(validBody({ taps: LONG_TAPS, token: justIssued }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'too_fast' });
    expect(upsertBest).not.toHaveBeenCalled();
  });

  it('accepts that same run once enough time has passed', async () => {
    // The pair matters: without this, a floor that rejected everything would
    // still pass the test above.
    const res = await post(validBody({ taps: LONG_TAPS }));
    expect(res.status).toBe(200);
    expect(upsertBest).toHaveBeenCalledWith(ADDRESS.toLowerCase(), LONG_RUN.score);
  });

  it('rejects an invalid trace', async () => {
    const res = await post(validBody({ taps: [5, 5, 5] })); // not strictly increasing
    expect(res.status).toBe(400);
    expect(upsertBest).not.toHaveBeenCalled();
  });

  it('rejects a malformed address', async () => {
    const res = await post(validBody({ address: 'nope' }));
    expect(res.status).toBe(400);
    expect(upsertBest).not.toHaveBeenCalled();
  });

  it('rejects a tap list longer than the engine cap without replaying it', async () => {
    const res = await post(validBody({ taps: Array.from({ length: 901 }, (_, i) => i * 5) }));
    expect(res.status).toBe(400);
    expect(upsertBest).not.toHaveBeenCalled();
  });
});
