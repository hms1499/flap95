/**
 * Turns a thrown wallet/chain failure into something a player can act on.
 *
 * Every caller used to render `e.message` straight into a dialog, which meant a revert
 * showed a wall of viem's ABI decoding. The raw text is kept as `detail` rather than
 * discarded — it is the only thing worth pasting into a bug report — and the UI hides it
 * behind a Details toggle, the way a 1995 error dialog would.
 */
export interface FriendlyError {
  message: string;
  /**
   * The original text, for the Details disclosure. Null when there was nothing to keep.
   * Optional so copy we wrote ourselves — which has no underlying raw text — can be built
   * as a bare `{ message }` without pretending there are details to expand.
   */
  detail?: string | null;
}

const FALLBACK = 'Something went wrong. No funds moved unless a transaction was confirmed.';

/**
 * Matched against the lowercased raw text. Custom errors (SelfAccept, WrongStatus) are
 * declared in our ABI, so viem decodes them by name and the name survives into the message.
 * Order matters: the first hit wins, so put the specific patterns above the broad ones.
 */
const RULES: [needle: string, message: string][] = [
  ['user rejected', 'You cancelled the request in your wallet.'],
  ['user denied', 'You cancelled the request in your wallet.'],
  ['selfaccept', "You can't accept your own duel."],
  ['wrongstatus', 'This duel is no longer open — someone else got there first, or it expired.'],
  ['badsignature', 'This duel could not be settled. Nothing was taken from your stake.'],
  ['exceeds balance', 'Not enough balance to cover this stake and its gas.'],
  ['insufficient funds', 'Not enough balance to cover this stake and its gas.'],
  ['insufficient allowance', 'Your wallet has not approved enough of this token yet. Try again.'],
];

export function friendlyError(e: unknown): FriendlyError {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : null;
  if (raw === null) return { message: FALLBACK, detail: null };

  const hay = raw.toLowerCase();
  const hit = RULES.find(([needle]) => hay.includes(needle));
  return { message: hit ? hit[1] : FALLBACK, detail: raw };
}
