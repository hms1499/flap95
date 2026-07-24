/**
 * The rename flow, as one state machine instead of three booleans.
 *
 * Setting a name is three separate waits — the wallet prompt, the block, then
 * the server re-reading the registry into its index — and `busy`/`saved`/`error`
 * collapsed all of them into a button that said "Confirming…" for the whole
 * half-minute and then a grey line of fineprint. Naming the stages is what lets
 * /profile show the same TxProgress the duel flow already uses.
 *
 * `edit` is deliberately inert mid-flight: once the transaction is broadcast a
 * keystroke cannot unsend it, and rewinding the UI to idle would hide a rename
 * that is still going to land.
 */
export type RenamePhase = 'idle' | 'signing' | 'confirming' | 'syncing' | 'done' | 'failed';

export type RenameEvent = 'submit' | 'signed' | 'confirmed' | 'synced' | 'fail' | 'edit';

/** Labels for TxProgress, indexed by `activeStep`. */
export const RENAME_STEPS = ['Sign in your wallet', 'Confirm on-chain', 'Save your name'];

const IN_FLIGHT: RenamePhase[] = ['signing', 'confirming', 'syncing'];

export function nextPhase(phase: RenamePhase, event: RenameEvent): RenamePhase {
  if (event === 'fail') return IN_FLIGHT.includes(phase) ? 'failed' : phase;
  if (event === 'edit') return IN_FLIGHT.includes(phase) ? phase : 'idle';
  if (event === 'submit') return IN_FLIGHT.includes(phase) ? phase : 'signing';
  if (event === 'signed') return phase === 'signing' ? 'confirming' : phase;
  if (event === 'confirmed') return phase === 'confirming' ? 'syncing' : phase;
  return phase === 'syncing' ? 'done' : phase;
}

/** Which step TxProgress highlights, or null when there is no transaction to draw. */
export function activeStep(phase: RenamePhase): number | null {
  const i = IN_FLIGHT.indexOf(phase);
  return i === -1 ? null : i;
}

/** Whether the name form is locked. Kept in step with `activeStep` by test. */
export function isBusy(phase: RenamePhase): boolean {
  return activeStep(phase) !== null;
}
