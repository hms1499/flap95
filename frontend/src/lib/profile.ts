import { keccak256, stringToHex, verifyMessage, type Address, type Hex } from 'viem';
import { ALIAS_RE } from './alias';

/** Trimmed, 1–16 chars: Unicode letters/digits (Vietnamese names work), space, _ . - */
const NAME_RE = /^[\p{L}\p{N} _.\-]{1,16}$/u;

export function normalizeName(
  raw: string,
): { ok: true; name: string } | { ok: false; error: 'bad_name' } {
  const name = raw.normalize('NFC').trim();
  if (!NAME_RE.test(name)) return { ok: false, error: 'bad_name' };
  // Generated aliases are not claimable: allowing one would let a stranger
  // impersonate whichever wallet that alias is derived from.
  if (ALIAS_RE.test(name)) return { ok: false, error: 'bad_name' };
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

/**
 * EOA-only (pure ecrecover): smart-contract wallets can't sign here.
 * Acceptable for MiniPay and browser extension wallets — see spec.
 */
export async function verifySignedAction(args: {
  address: string;
  message: string;
  signature: string;
  timestamp: number;
  now?: number;
}): Promise<'ok' | 'stale' | 'bad_signature'> {
  const now = args.now ?? Date.now();
  if (!Number.isFinite(args.timestamp) || Math.abs(now - args.timestamp) > SIG_FRESH_MS) return 'stale';
  const valid = await verifyMessage({
    address: args.address as Address,
    message: args.message,
    signature: args.signature as Hex,
  }).catch(() => false);
  return valid ? 'ok' : 'bad_signature';
}
