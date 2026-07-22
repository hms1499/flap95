import { createHmac, timingSafeEqual } from 'node:crypto';
import { CONFIG } from '@/engine/engine';

/**
 * A practice seed the server issued, carried by the client and handed back with
 * the run.
 *
 * Replaces the browser-chosen seed. Letting the client pick meant a solver
 * could choose a seed, compute an optimal tap sequence offline against this
 * same deterministic engine, and submit a run that verifies perfectly — which
 * the old per-run signature did nothing to prevent, because the solver signs
 * with its own key.
 *
 * Stateless on purpose: an HMAC plus an embedded issue time needs no table and
 * no cleanup job. Reusing a token is harmless — the same seed and taps produce
 * the same score, and upsertBest only ever raises one.
 */
export const SEED_TTL_MS = 600_000;

/** Tolerance for network latency and clock drift on the wall-clock floor. */
export const SUBMIT_SLACK_MS = 1_500;

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function issueSeedToken(seed: number, issuedAt: number, secret: string): string {
  const payload = Buffer.from(`${seed}.${issuedAt}`).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export type SeedTokenResult =
  | { ok: true; seed: number; issuedAt: number }
  | { ok: false; error: 'bad_token' | 'stale_token' };

export function verifySeedToken(token: string, secret: string, now: number): SeedTokenResult {
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return { ok: false, error: 'bad_token' };

  const expected = sign(payload, secret);
  const given = Buffer.from(mac);
  const want = Buffer.from(expected);
  // Length must match before timingSafeEqual, which throws on a mismatch.
  if (given.length !== want.length || !timingSafeEqual(given, want))
    return { ok: false, error: 'bad_token' };

  const [seedStr, issuedStr] = Buffer.from(payload, 'base64url').toString().split('.');
  const seed = Number(seedStr);
  const issuedAt = Number(issuedStr);
  if (!Number.isInteger(seed) || !Number.isInteger(issuedAt)) return { ok: false, error: 'bad_token' };

  // A token from the future is as suspect as an expired one.
  if (now < issuedAt || now - issuedAt > SEED_TTL_MS) return { ok: false, error: 'stale_token' };
  return { ok: true, seed, issuedAt };
}

/**
 * True when a run could not physically have been played in the time between the
 * seed being issued and the score arriving.
 *
 * This is the check a solver cannot satisfy cheaply: it can find a perfect tap
 * sequence in milliseconds, but it cannot make 30 seconds of game time pass in
 * 2 seconds of wall time.
 */
export function submittedTooFast(deathTick: number, issuedAt: number, now: number): boolean {
  const playedMs = (deathTick / CONFIG.ticksPerSecond) * 1000;
  return now - issuedAt < playedMs - SUBMIT_SLACK_MS;
}
