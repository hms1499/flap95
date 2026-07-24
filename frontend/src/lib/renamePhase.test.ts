import { describe, it, expect } from 'vitest';
import {
  RENAME_STEPS, activeStep, isBusy, nextPhase, type RenamePhase,
} from './renamePhase';

describe('nextPhase', () => {
  it('walks a successful rename through every on-chain stage', () => {
    // Three waits the old boolean `busy` collapsed into one: the wallet prompt,
    // the block, and the server re-reading the registry.
    expect(nextPhase('idle', 'submit')).toBe('signing');
    expect(nextPhase('signing', 'signed')).toBe('confirming');
    expect(nextPhase('confirming', 'confirmed')).toBe('syncing');
    expect(nextPhase('syncing', 'synced')).toBe('done');
  });

  it('fails out of any in-flight stage', () => {
    const inFlight: RenamePhase[] = ['signing', 'confirming', 'syncing'];
    for (const p of inFlight) expect(nextPhase(p, 'fail')).toBe('failed');
  });

  it('lets editing the name clear a finished attempt', () => {
    // "Saved." sitting under a half-typed new name claims something that has
    // not happened yet.
    expect(nextPhase('done', 'edit')).toBe('idle');
    expect(nextPhase('failed', 'edit')).toBe('idle');
  });

  it('ignores editing while a transaction is in flight', () => {
    // The transaction is already broadcast. Letting a keystroke rewind the UI to
    // idle would hide a rename that is still going to land.
    const inFlight: RenamePhase[] = ['signing', 'confirming', 'syncing'];
    for (const p of inFlight) expect(nextPhase(p, 'edit')).toBe(p);
  });

  it('ignores a second submit while one is already running', () => {
    expect(nextPhase('signing', 'submit')).toBe('signing');
    expect(nextPhase('syncing', 'submit')).toBe('syncing');
  });

  it('lets a finished attempt start a new one', () => {
    expect(nextPhase('done', 'submit')).toBe('signing');
    expect(nextPhase('failed', 'submit')).toBe('signing');
  });
});

describe('activeStep', () => {
  it('maps each in-flight stage onto its progress step', () => {
    expect(activeStep('signing')).toBe(0);
    expect(activeStep('confirming')).toBe(1);
    expect(activeStep('syncing')).toBe(2);
  });

  it('has a step for every stage it can report', () => {
    for (const p of ['signing', 'confirming', 'syncing'] as RenamePhase[]) {
      expect(RENAME_STEPS[activeStep(p)!]).toBeTypeOf('string');
    }
    expect(RENAME_STEPS).toHaveLength(3);
  });

  it('reports no step when nothing is in flight, so no progress bar is drawn', () => {
    expect(activeStep('idle')).toBeNull();
    expect(activeStep('done')).toBeNull();
    expect(activeStep('failed')).toBeNull();
  });
});

describe('isBusy', () => {
  it('locks the form for exactly the stages that cannot be interrupted', () => {
    expect(isBusy('signing')).toBe(true);
    expect(isBusy('confirming')).toBe(true);
    expect(isBusy('syncing')).toBe(true);
  });

  it('leaves the form open before the first attempt and after the last', () => {
    expect(isBusy('idle')).toBe(false);
    expect(isBusy('done')).toBe(false);
    expect(isBusy('failed')).toBe(false);
  });

  it('is busy exactly when there is a step to show', () => {
    // The two must not drift: a locked form with no progress shown is the
    // silent wait this whole state machine exists to remove.
    const all: RenamePhase[] = ['idle', 'signing', 'confirming', 'syncing', 'done', 'failed'];
    for (const p of all) expect(isBusy(p)).toBe(activeStep(p) !== null);
  });
});
