'use client';
import { useEffect, useState } from 'react';

/** Batch-resolves profile names for the given addresses. Keys are lowercase. */
export function useNames(addresses: (string | null | undefined)[]): Record<string, string> {
  const key = [...new Set(
    addresses.filter((a): a is string => !!a).map((a) => a.toLowerCase()),
  )].sort().join(',');
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!key) return;
    let stale = false;
    fetch(`/api/names?addrs=${key}`)
      .then((r) => r.json())
      .then((d) => { if (!stale) setNames(d.names ?? {}); })
      .catch(() => {});
    return () => { stale = true; };
  }, [key]);
  return names;
}

export function displayName(names: Record<string, string>, address: string): string {
  return names[address.toLowerCase()] ?? `${address.slice(0, 8)}…`;
}
