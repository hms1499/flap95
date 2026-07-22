/**
 * A display name for an address that has not claimed one.
 *
 * Derived from the address, not stored anywhere: no transaction, no signature,
 * no registration, and identical on the client and the server. Its only job is
 * to keep raw 0x addresses out of the UI (a MiniPay copy rule) and to let a
 * player appear on the leaderboard before deciding whether they want a real
 * name.
 *
 * Collisions are possible (32 words x 4096 suffixes) and harmless: this is a
 * label, never a key. Scores, duels and ranking are keyed by address.
 */
const WORDS = [
  'SPARROW', 'TAILWIND', 'PIPEDREAM', 'BRASSCOG', 'SKYLARK', 'DRIFTER', 'FEATHER', 'JETSTREAM',
  'CLOUDHOP', 'WINGNUT', 'GLIDER', 'THERMAL', 'UPDRAFT', 'CRESTED', 'SWIFTBEAK', 'PLUMAGE',
  'RUFFLED', 'NESTEGG', 'TALON', 'FLYWAY', 'PERCH', 'ROOST', 'QUILL', 'DOWNDRAFT',
  'SKIMMER', 'SOARER', 'HOLLOWBONE', 'WINGBEAT', 'PIPEFITTER', 'GREENPIPE', 'GOLDCREST', 'PIXELWING',
] as const;

/** The shape every generated alias takes. `normalizeName` rejects claimed names matching it. */
export const ALIAS_RE = /^[A-Z]+_[0-9A-F]{3}$/;

export function aliasFor(address: string): string {
  const hex = address.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(hex)) return 'PLAYER_000';
  const word = WORDS[parseInt(hex.slice(0, 2), 16) % WORDS.length];
  return `${word}_${hex.slice(-3).toUpperCase()}`;
}
