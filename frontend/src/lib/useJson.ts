'use client';
import { useCallback, useEffect, useState } from 'react';
import { fetchJson } from './fetchJson';

/**
 * The data half of the section contract: loading, error, or data — never two at
 * once, and never "empty" standing in for "not loaded yet".
 *
 * `url === null` means the caller is not ready (no wallet connected, say): the
 * hook stays in its loading state and issues no request. The cancellation flag
 * is why this exists as one hook rather than three copies: without it, switching
 * wallets could land the previous wallet's response under the new address.
 */
export function useJson<T>(url: string | null): {
  data: T | null; error: boolean; loading: boolean; reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(false);
    setLoading(true);
    if (url === null) return;
    void fetchJson<T>(url).then((r) => {
      if (cancelled) return;
      if (r.ok) setData(r.data); else setError(true);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [url, nonce]);

  return { data, error, loading, reload };
}
