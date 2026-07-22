import { keccak256, stringToHex } from 'viem';

/** Trimmed, 1–16 chars: Unicode letters/digits (Vietnamese names work), space, _ . - */
const NAME_RE = /^[\p{L}\p{N} _.\-]{1,16}$/u;

export function normalizeName(
  raw: string,
): { ok: true; name: string } | { ok: false; error: 'bad_name' } {
  const name = raw.trim();
  if (!NAME_RE.test(name)) return { ok: false, error: 'bad_name' };
  return { ok: true, name };
}

/** A signed action is rejected when its timestamp is further than this from server time. */
export const SIG_FRESH_MS = 600_000;

export function tapsHash(taps: readonly number[]): string {
  return keccak256(stringToHex(JSON.stringify(taps)));
}

export function setNameMessage(name: string, timestamp: number): string {
  return `flap95 set-name:${name} ts:${timestamp}`;
}

export function practiceMessage(seed: number, tapsHashHex: string, timestamp: number): string {
  return `flap95 practice seed:${seed} taps:${tapsHashHex} ts:${timestamp}`;
}
