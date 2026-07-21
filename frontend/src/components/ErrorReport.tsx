'use client';
import { useState } from 'react';
import type { FriendlyError } from '@/lib/friendlyError';

/**
 * The body of an error dialog: a sentence the player can act on, with the raw chain text
 * folded away behind a Details toggle — the same move a 1995 system dialog made, and the
 * reason the underlying string is kept rather than thrown away.
 */
export function ErrorReport({ error }: { error: FriendlyError }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p>⚠️ {error.message}</p>
      {error.detail && (
        <>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            style={{ marginBottom: open ? 8 : 0 }}
          >
            Details {open ? '<<' : '>>'}
          </button>
          {open && (
            <p className="mono" style={{ fontSize: 11, maxHeight: 140, overflowY: 'auto', wordBreak: 'break-word' }}>
              {error.detail}
            </p>
          )}
        </>
      )}
    </>
  );
}
