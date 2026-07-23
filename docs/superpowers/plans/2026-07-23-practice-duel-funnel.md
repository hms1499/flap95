# Practice → duel funnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the practice game-over screen a funnel to staked duels — the score saves itself, and "Duel for stablecoins" becomes the single primary action.

**Architecture:** One client component, `frontend/src/app/play/page.tsx`. A manual save button and its `saved`/`busy` booleans are replaced by a `saveState` machine driven by an auto-save effect keyed on `[result, address, seed, saveNonce]`. No API, DB, or contract changes — `POST /api/practice` and `upsertBest` are reused unchanged (`upsertBest` already keeps only the best score, so re-saving every run is harmless).

**Tech Stack:** Next.js (App Router, client component), React hooks, wagmi (`useAccount`/`useConnect`).

## Global Constraints

- **Copy rules:** no raw `0x…` in ordinary UI (only the alias or a claimed name); "network fee" never "gas"; no "CELO" user-facing.
- **No new lint problems.** The repo's eslint baseline is **12 problems (11 errors, 1 warning)**; this change must not raise it. In particular, do not call `setState` synchronously in an effect body — put it inside the async IIFE, the way the seed effect already does (this is why the auto-save effect sets `saveState` from inside its IIFE).
- **Practice needs no signature and no wallet to play** — a wallet is required only to save and to duel.

---

### Task 1: Auto-save and a duel-primary game-over screen

**Files:**
- Modify (full rewrite): `frontend/src/app/play/page.tsx`

**Interfaces:**
- Consumes: `GET /api/practice/seed` and `POST /api/practice` (unchanged); `aliasFor` from `@/lib/alias`; `Window`, `Dialog95`, `GameCanvas` components.
- Produces: nothing other files depend on.

- [ ] **Step 1: Rewrite the page**

Replace the entire contents of `frontend/src/app/play/page.tsx` with:

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAccount, useConnect } from 'wagmi';
import { Window } from '@/components/Window';
import { Dialog95 } from '@/components/Dialog95';
import { GameCanvas } from '@/components/GameCanvas';
import { aliasFor } from '@/lib/alias';

interface Seed { seed: number; token: string }
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function PlayPage() {
  const [seed, setSeed] = useState<Seed | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [result, setResult] = useState<{ taps: number[]; score: number } | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveNonce, setSaveNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();

  // Every run plays a seed the server issued. A browser-chosen seed could be
  // solved offline before the run was ever played. The fetch lives inside the
  // effect (not a useCallback) so the linter does not see a setState reachable
  // from an effect body, and so a slow seed landing after "Play again" can be
  // cancelled instead of overwriting the newer round's seed.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/practice/seed');
        if (!res.ok) throw new Error('bad status');
        const next = await res.json();
        if (!cancelled) setSeed(next);
      } catch {
        if (!cancelled) setError('Could not start a round. Check your connection and try again.');
      }
    })();
    return () => { cancelled = true; };
  }, [runKey]);

  useEffect(() => {
    setProfileName(null);
    if (!address) return;
    let stale = false;
    fetch(`/api/profile?address=${address}`)
      .then((r) => r.json())
      .then((d) => { if (!stale) setProfileName(d.name ?? null); })
      .catch(() => {});
    return () => { stale = true; };
  }, [address]);

  // Practice scores are the funnel's social proof, so a finished run saves
  // itself the moment a wallet is present — no button, no signature. The server
  // keeps only the best score, so re-saving every run is harmless. Keyed on
  // [result, address, seed] rather than saveState so it cannot re-enter itself
  // and cancel its own in-flight save; a run finished *before* connecting saves
  // when `address` later attaches. saveNonce lets the error retry re-run it.
  // setSaveState lives inside the IIFE to avoid a set-state-in-effect lint error.
  useEffect(() => {
    if (!result || !address || !seed) return;
    let cancelled = false;
    void (async () => {
      setSaveState('saving');
      try {
        const res = await fetch('/api/practice', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ address, seed: seed.seed, taps: result.taps, token: seed.token }),
        });
        if (!cancelled) setSaveState(res.ok ? 'saved' : 'error');
      } catch {
        if (!cancelled) setSaveState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [result, address, seed, saveNonce]);

  const onRunEnd = useCallback((taps: number[], score: number) => setResult({ taps, score }), []);

  function again() {
    // Bumping runKey does double duty: it remounts the canvas for a fresh run
    // and re-runs the seed effect above, so a new round always plays a seed the
    // server issued for it.
    setResult(null); setSaveState('idle'); setError(null); setSeed(null);
    setRunKey((k) => k + 1);
  }

  const shownAs = profileName ?? (address ? aliasFor(address) : null);

  return (
    <main className="desktop">
      <Window title="PRACTICE.EXE — tap to flap">
        {seed === null
          ? <p>Loading…</p>
          : <GameCanvas key={runKey} seed={seed.seed} onRunEnd={onRunEnd} />}
      </Window>
      <Dialog95 title="Game over" open={result !== null}>
        <p>⚠️ You scored <b>{result?.score}</b>.</p>

        {!isConnected ? (
          <button
            onClick={() => connectors[0] && connect({ connector: connectors[0] })}
            style={{ width: '100%' }}
          >
            💰 Connect to keep your score & duel
          </button>
        ) : (
          <>
            {saveState === 'saving' && <p className="fineprint">Saving your score…</p>}
            {saveState === 'saved' && <p>Saved to the Hall of Fame as <b>{shownAs}</b>.</p>}
            {saveState === 'error' && (
              <p className="fineprint">
                ⚠️ Couldn&apos;t save your score.{' '}
                <button onClick={() => setSaveNonce((n) => n + 1)}>Try again</button>
              </p>
            )}
            <a className="button" href="/duels/new">
              <button style={{ width: '100%' }}>⚔️ Duel for stablecoins</button>
            </a>
            {/* The duel is a fresh run on its own server-issued seed (both players
                run the same one), so this practice score is not carried into it —
                it stays on the Hall of Fame. */}
            <p className="fineprint">
              A duel is a fresh run for real stakes — this practice score stays on the Hall of Fame.
            </p>
          </>
        )}

        {isConnected && shownAs !== null && !profileName && (
          <p className="fineprint">
            You appear as <b>{shownAs}</b>. Want your own name? Set it on your profile.
          </p>
        )}

        {error && <p className="fineprint">⚠️ {error}</p>}

        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={again}>Play again</button>
        </div>
      </Dialog95>
    </main>
  );
}
```

- [ ] **Step 2: Type-check**

Run in `frontend/`: `npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 3: Lint — confirm no new problems**

Run in `frontend/`: `npx eslint src 2>&1 | grep '✖'`
Expected: `✖ 12 problems (11 errors, 1 warning)` — unchanged from the baseline. If the count rose, a `setState` call ended up synchronous in an effect body; move it inside the async IIFE.

- [ ] **Step 4: Run the test suite (unaffected)**

Run in `frontend/`: `npm test`
Expected: all suites pass (this file has no unit tests; the suite must stay green). Record the number — it should match the pre-change count (142).

- [ ] **Step 5: Verify by hand**

Start `npm run dev` and open `http://localhost:3000/play` at a 360×640 viewport.

1. **Connected wallet:** play a run to death. With **no button press**, the status advances "Saving your score…" → "Saved to the Hall of Fame as `<ALIAS>`", and the primary action is a full-width **⚔️ Duel for stablecoins**. "Play again" is the only other button.
2. **Disconnected:** disconnect the wallet, play a run. The primary button reads **💰 Connect to keep your score & duel**. Connect — the score then saves itself ("Saved to the Hall of Fame as …") and the primary becomes the duel button, without replaying.
3. **Save failure:** with the wallet connected, stop the dev server (or go offline) and play a run. The status shows "Couldn't save your score. [Try again]" and does **not** loop; restart the server and click **Try again** → "Saved…".
4. **Play again:** click it — a new round starts (canvas resets, new seed) and the save status is cleared.

- [ ] **Step 6: Commit**

```bash
cd /Users/vanhuy/Desktop/celo-game
git add frontend/src/app/play/page.tsx
git commit -m "feat(play): auto-save the score and make the duel the primary action"
```
