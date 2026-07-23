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
