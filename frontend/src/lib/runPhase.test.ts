import { describe, it, expect } from 'vitest';
import { COUNTDOWN_MS, countdownLabel, onPointerDown, type RunPhase } from './runPhase';

describe('onPointerDown', () => {
  it('the first tap starts the countdown and is NOT a flap', () => {
    // This is the whole point of the pre-roll: the tap that wakes the game up must not
    // also fire the bird upward at tick 0.
    expect(onPointerDown('idle')).toEqual({ phase: 'countdown', isFlap: false });
  });
  it('taps during the countdown are swallowed', () => {
    expect(onPointerDown('countdown')).toEqual({ phase: 'countdown', isFlap: false });
  });
  it('taps once running are flaps', () => {
    expect(onPointerDown('running')).toEqual({ phase: 'running', isFlap: true });
  });
  it('never reports a flap before the run starts', () => {
    const before: RunPhase[] = ['idle', 'countdown'];
    for (const p of before) expect(onPointerDown(p).isFlap).toBe(false);
  });
});

describe('countdownLabel', () => {
  it('counts 3, 2, 1 then GO across the countdown window', () => {
    expect(countdownLabel(0)).toBe('3');
    expect(countdownLabel(400)).toBe('2');
    expect(countdownLabel(800)).toBe('1');
    expect(countdownLabel(1200)).toBe('GO');
  });
  it('still reads GO at the exact end of the window', () => {
    expect(countdownLabel(COUNTDOWN_MS)).toBe('GO');
  });
});
