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
  const [nonce, setNonce] = useState(0);
  const [key, setKey] = useState(url);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // Only a new key discards what is already on screen. A reload of the same key
  // revalidates underneath it, so a section that reloads to show the result of an
  // action does not blank out at the moment the action succeeds — which is also
  // the moment any "done" notice rendered beside that data would be unmounted.
  //
  // Adjusted during render rather than in an effect so the discard cannot survive
  // even one paint: an effect would show the previous wallet's data under the new
  // address for a frame first.
  if (key !== url) {
    setKey(url);
    setData(null);
  }

  useEffect(() => {
    let cancelled = false;
    setError(false);
    if (url === null) return;
    void fetchJson<T>(url).then((r) => {
      if (cancelled) return;
      if (r.ok) setData(r.data); else setError(true);
    });
    return () => { cancelled = true; };
  }, [url, nonce]);

  // Derived rather than stored: "loading" is precisely having nothing to show
  // yet, and a stored flag could disagree with the data it describes.
  return { data, error, loading: data === null && !error, reload };
}
