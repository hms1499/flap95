'use client';
import { useEffect, useState } from 'react';

/**
 * Wall-clock time that re-renders its consumer on an interval, for countdowns.
 *
 * Returns null on the server and on the first client render so both agree — reading
 * Date.now() during render instead would let a server and client straddling a minute
 * boundary emit different text and trip hydration. Callers render nothing until it
 * ticks. Mirrors the taskbar Clock in Shell.tsx.
 */
export function useNow(intervalMs = 30_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
