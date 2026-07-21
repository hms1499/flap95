import { describe, it, expect } from 'vitest';
import { friendlyError } from './friendlyError';

describe('friendlyError', () => {
  it('reads a wallet rejection as a cancellation, not a failure', () => {
    const r = friendlyError(new Error('User rejected the request.'));
    expect(r.message).toBe('You cancelled the request in your wallet.');
    expect(r.detail).toBe('User rejected the request.');
  });

  it('explains SelfAccept in the player’s terms', () => {
    const raw = 'The contract function "acceptDuel" reverted.\n\nError: SelfAccept()';
    expect(friendlyError(new Error(raw)).message).toBe("You can't accept your own duel.");
  });

  it('explains WrongStatus as the duel having moved on', () => {
    const raw = 'The contract function "acceptDuel" reverted.\n\nError: WrongStatus()';
    expect(friendlyError(new Error(raw)).message)
      .toBe('This duel is no longer open — someone else got there first, or it expired.');
  });

  it('names the missing funds when the wallet is short', () => {
    const r = friendlyError(new Error('transfer amount exceeds balance'));
    expect(r.message).toBe('Not enough balance to cover this stake and its gas.');
  });

  it('keeps the raw text as detail so the truth is still reachable', () => {
    const raw = 'some unmapped chain failure';
    expect(friendlyError(new Error(raw))).toEqual({
      message: 'Something went wrong. No funds moved unless a transaction was confirmed.',
      detail: raw,
    });
  });

  it('handles a thrown non-Error without inventing a detail', () => {
    expect(friendlyError('boom')).toEqual({
      message: 'Something went wrong. No funds moved unless a transaction was confirmed.',
      detail: 'boom',
    });
  });

  it('has no detail to show when there is nothing to show', () => {
    expect(friendlyError(undefined).detail).toBeNull();
  });
});
