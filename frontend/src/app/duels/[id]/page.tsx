'use client';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useConnect, usePublicClient, useWriteContract } from 'wagmi';
import { formatUnits } from 'viem';
import { Window } from '@/components/Window';
import { Dialog95 } from '@/components/Dialog95';
import { GameCanvas } from '@/components/GameCanvas';
import { TxProgress } from '@/components/TxProgress';
import { DuelResult } from '@/components/DuelResult';
import { ESCROW_ADDRESS, duelEscrowAbi, erc20Abi, tokenByAddress } from '@/lib/contracts';
import { feeCurrencyOverrides } from '@/lib/minipay';
import { friendlyError, type FriendlyError } from '@/lib/friendlyError';
import { ErrorReport } from '@/components/ErrorReport';
import { orientResult, viewerRole } from '@/lib/outcome';
import { loadDuelSeed, clearDuelSeed } from '@/lib/duelSeedStore';
import { timeLeft } from '@/lib/duelClock';
import { useNow } from '@/lib/useNow';
import { useNames, displayName } from '@/lib/useNames';

type Phase = 'loading' | 'preview' | 'settled' | 'funded' | 'pending' | 'reclaim' | 'reclaiming' | 'approving' | 'accepting' | 'binding' | 'playing' | 'submitting' | 'result' | 'error';

interface Detail {
  id: number; onchainId: string | null; status: string; stakeWei: string; token: string | null;
  creator: string; acceptor: string | null; createdAt: string; updatedAt: string;
  winner: 'creator' | 'acceptor' | 'tie' | null;
  creatorScore: number | null; acceptorScore: number | null;
  creatorDeathTick: number | null; acceptorDeathTick: number | null;
  settleTx: string | null;
}
interface Outcome { winner: 'creator' | 'acceptor' | 'tie'; creatorScore: number; acceptorScore: number; settleTx: string | null }

/** Mirrors DuelEscrow.EXPIRY / SETTLE_TIMEOUT (both 24 hours). */
const EXPIRY_SEC = 24 * 60 * 60;
const EXPIRY_MS = EXPIRY_SEC * 1000;

/**
 * Which on-chain escape hatch this duel is eligible for, per DuelEscrow:
 *  - refundStale(id):   requires Status.Accepted and now > acceptedAt + SETTLE_TIMEOUT.
 *                       Refunds BOTH players their stake. Permissionless — anyone can call.
 *  - cancelExpired(id): requires Status.Open and now > createdAt + EXPIRY.
 *                       Refunds ONLY the creator (no acceptor ever staked).
 */
type ReclaimKind = 'refundStale' | 'cancelExpired';

export default function DuelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const now = useNow();
  const [phase, setPhase] = useState<Phase>('loading');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [ghost, setGhost] = useState<{ seed: number; ghostTaps: number[] } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [reclaimKind, setReclaimKind] = useState<ReclaimKind | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  // Creator-resume of a funded duel: the seed read from localStorage, whether the
  // run has been started, and the score once the finished run is recorded.
  const [resumeSeed, setResumeSeed] = useState<number | null>(null);
  const [resumeStarted, setResumeStarted] = useState(false);
  const [resumeScore, setResumeScore] = useState<number | null>(null);
  const names = useNames([detail?.creator]);

  // Held in a ref rather than named as an effect dependency. The loader below must run
  // exactly once per duel id: it owns `phase`, and re-running it mid-flight resets that out
  // from under whatever the user is doing. wagmi returns a NEW client object whenever the
  // connected chain changes, so listing it as a dependency meant a network switch during a
  // run discarded the run, and during accept() discarded a stake the user had already paid
  // to approve.
  const publicClientRef = useRef(publicClient);
  // Declared before the loader effect so it syncs first on mount; the loader also awaits a
  // fetch before reading the ref, so it always sees the current client either way.
  useEffect(() => { publicClientRef.current = publicClient; }, [publicClient]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d: Detail = await fetch(`/api/duels/${id}`).then((r) => r.json());
      if (cancelled) return;
      setDetail(d);

      // The DB status alone can't decide this: it may lag or diverge from the chain (an
      // acceptDuel that landed but whose binding call died, a settle relay that reverted).
      // So once a non-terminal row is old enough to be eligible for an escape hatch, ask
      // the contract what state it's really in and offer the hatch that actually applies.
      const terminal = d.status === 'settled' || d.status === 'cancelled';
      const ageMs = Date.now() - Date.parse(d.updatedAt);
      // A NaN age (unparseable timestamp) counts as stale on purpose: it routes to the chain
      // read below, which is authoritative and needs no timestamp from us. Letting NaN fall
      // through the `>` instead would silently answer "not stale" and hide the escape hatch.
      const maybeStale = !terminal && (Number.isNaN(ageMs) || ageMs > EXPIRY_MS);

      // A settled duel is a result, not an error. The creator never sees their own outcome
      // any other way — they stake, play, wait, and their only other signal that they won
      // is noticing the balance move.
      if (d.status === 'settled' && d.winner !== null) { setPhase('settled'); return; }

      if (!maybeStale) {
        // Fast path: a live duel still inside its window needs no chain read.
        if (d.status === 'open') { setPhase('preview'); return; }
        // A funded duel is one the creator staked but never finished the run for.
        // Only fresh ones resume here; an old funded duel is maybeStale and must
        // fall through to the cancelExpired refund path below, so this stays inside
        // the !maybeStale block.
        if (d.status === 'funded') { setPhase('funded'); return; }
        // Both stakes are locked while the acceptor plays ('accepted') and while the settle
        // relay is in flight ('settling'). Neither is an error and neither is actionable yet:
        // refundStale only unlocks 24h after accept, which is the maybeStale path below. The
        // profile page links participants straight here, so say what is happening to their
        // money instead of "This duel is not open."
        if (d.status === 'accepted' || d.status === 'settling') { setPhase('pending'); return; }
        setPhase('error');
        setError({ message: 'This duel is not open.' });
        return;
      }

      // Past this point the DB row is old enough that it may no longer describe the chain, so
      // the chain decides — including whether the duel is still acceptable. Falling back to
      // the DB status here used to offer an Accept button on an expired duel, and acceptDuel
      // reverts once block.timestamp passes createdAt + EXPIRY. The user only discovers that
      // after paying for the ERC-20 approve that accept() sends first.
      const client = publicClientRef.current;
      if (!d.onchainId || !client) {
        setPhase('error');
        setError({ message: 'This duel has expired and its on-chain state could not be checked. Reload to try again.' });
        return;
      }

      try {
        const oc = await client.readContract({
          address: ESCROW_ADDRESS, abi: duelEscrowAbi, functionName: 'duels',
          args: [BigInt(d.onchainId)],
        });
        if (cancelled) return;
        const [, , , createdAt, onchainStatus, , acceptedAt] = oc;
        const nowSec = Math.floor(Date.now() / 1000);
        // Both contract checks are strict `>` (they revert on `<=`), so mirror that
        // exactly — offering a button that reverts is worse than not offering it.
        if (onchainStatus === 2 && nowSec > Number(acceptedAt) + EXPIRY_SEC) {
          setReclaimKind('refundStale'); setPhase('reclaim'); return;
        }
        if (onchainStatus === 1 && nowSec > Number(createdAt) + EXPIRY_SEC) {
          setReclaimKind('cancelExpired'); setPhase('reclaim'); return;
        }
        // Still Open and not yet expired — the row's updated_at ran ahead of the chain (a
        // sync bumped it), so the duel really is joinable.
        if (onchainStatus === 1) { setPhase('preview'); return; }
        setPhase('error');
        setError({ message: 'This duel is not open.' });
      } catch (e) {
        if (cancelled) return;
        console.error('on-chain status read failed', e);
        setPhase('error');
        setError({ message: 'Could not reach the network to check this duel. Reload to try again.' });
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // localStorage is client-only, so read the stashed seed in an effect (not during
  // render) to avoid a hydration mismatch. Runs once the funded phase is entered.
  useEffect(() => {
    if (phase === 'funded' && detail) setResumeSeed(loadDuelSeed(localStorage, detail.id));
  }, [phase, detail]);

  async function accept() {
    if (!detail || !address || !publicClient || !detail.onchainId) return;
    const stakeToken = detail.token ? tokenByAddress(detail.token) : undefined;
    if (!stakeToken) { setError({ message: 'Unknown stake currency.' }); setPhase('error'); return; }
    const stake = BigInt(detail.stakeWei);
    try {
      setPhase('approving');
      const allowance = await publicClient.readContract({
        address: stakeToken.address, abi: erc20Abi, functionName: 'allowance', args: [address, ESCROW_ADDRESS],
      });
      if (allowance < stake) {
        const tx = await writeContractAsync({
          address: stakeToken.address, abi: erc20Abi, functionName: 'approve',
          args: [ESCROW_ADDRESS, stake], ...feeCurrencyOverrides(),
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
      }
      setPhase('accepting');
      const acceptTx = await writeContractAsync({
        address: ESCROW_ADDRESS, abi: duelEscrowAbi, functionName: 'acceptDuel',
        args: [BigInt(detail.onchainId)], ...feeCurrencyOverrides(),
      });
      setPhase('binding');
      const res = await fetch(`/api/duels/${id}/accept`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txHash: acceptTx }),
      });
      if (!res.ok) throw new Error('accept binding failed');
      const data = await res.json();
      setGhost({ seed: data.seed, ghostTaps: data.ghostTaps ?? [] });
      setPhase('playing');
    } catch (e) {
      setError(friendlyError(e));
      setPhase('error');
    }
  }

  async function reclaim() {
    if (!detail || !address || !publicClient || !detail.onchainId || !reclaimKind) return;
    try {
      setPhase('reclaiming');
      const tx = await writeContractAsync({
        address: ESCROW_ADDRESS, abi: duelEscrowAbi, functionName: reclaimKind,
        args: [BigInt(detail.onchainId)], ...feeCurrencyOverrides(),
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      // Sync the DB immediately so the reconciler doesn't try to relay settle() against a
      // duel that's already Cancelled on-chain. Best-effort: the refund already succeeded
      // on-chain, so a failure here must not surface as "Reclaim failed" — the reconciler's
      // chain pre-flight is the backstop that will catch it on the next tick.
      try {
        await fetch(`/api/duels/${detail.id}/refunded`, { method: 'POST' });
      } catch (syncErr) {
        console.error('refunded sync failed (non-fatal, reconciler will catch up)', syncErr);
      }
      router.push('/duels');
    } catch (e) {
      setError(friendlyError(e));
      setPhase('error');
    }
  }

  const onRunEnd = useCallback(async (taps: number[]) => {
    setPhase('submitting');
    const res = await fetch(`/api/duels/${id}/replay`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'acceptor', taps }),
    });
    if (!res.ok) { setError({ message: 'Replay rejected' }); setPhase('error'); return; }
    setOutcome(await res.json());
    setPhase('result');
  }, [id]);

  const onCreatorRunEnd = useCallback(async (taps: number[]) => {
    if (!detail) return;
    const res = await fetch(`/api/duels/${detail.id}/replay`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'creator', taps }),
    });
    if (!res.ok) { setError({ message: 'Could not save your run. Try again.' }); setPhase('error'); return; }
    const data = await res.json();
    clearDuelSeed(localStorage, detail.id);
    setResumeScore(data.score);
  }, [detail]);

  const duelToken = detail?.token ? tokenByAddress(detail.token) : undefined;
  const symbol = duelToken?.symbol ?? 'USDm';
  const stakeStr = detail ? formatUnits(BigInt(detail.stakeWei), duelToken?.decimals ?? 18) : '';
  const iWon = outcome?.winner === 'acceptor';
  const tie = outcome?.winner === 'tie';
  // Null until the clock mounts, so the countdown line simply isn't there on first paint
  // rather than flashing a server-rendered time that disagrees with the client's.
  const left = detail && now !== null ? timeLeft(Date.parse(detail.createdAt), now) : null;

  return (
    <main className="desktop">
      {phase === 'loading' && <Window title="DUEL.EXE"><p>Loading…</p></Window>}
      {phase === 'preview' && detail && viewerRole(address, detail.creator, detail.acceptor) === 'creator' && (
        <Window title={`DUEL_${detail.id}.EXE — yours`}>
          <p>⏳ Your duel is open, waiting for a challenger.</p>
          <p style={{ fontSize: 12 }}>Stake held: <b className="stake">{stakeStr} {symbol}</b>. Share this page&apos;s link and
            whoever opens it can accept. You can&apos;t accept your own duel.</p>
          {left && (
            <p className="fineprint">
              {left.expired
                ? 'Nobody accepted in time. Reload this page to reclaim your stake.'
                : `Open for another ${left.label}. After that, come back here to reclaim your stake.`}
            </p>
          )}
          <button onClick={() => router.push('/duels')} style={{ width: '100%' }}>Back to duels</button>
        </Window>
      )}
      {phase === 'preview' && detail && viewerRole(address, detail.creator, detail.acceptor) !== 'creator' && (
        <Window title={`DUEL_${detail.id}.EXE`}>
          <p>⚔️ Stake: <b className="stake">{stakeStr} {symbol}</b> · vs <span className="mono">{displayName(names, detail.creator)}</span></p>
          <p style={{ fontSize: 12 }}>Same pipes, same physics. Beat their ghost, take the pot (minus 5% fee). Scores stay hidden until you finish — no sniping.</p>
          {left && <p className="fineprint">{left.expired ? 'This duel has expired.' : `Accept within ${left.label} — after that it expires and the stake goes back.`}</p>}
          {isConnected
            ? <button onClick={accept} style={{ width: '100%' }}>Accept duel — stake {stakeStr} {symbol}</button>
            : <button onClick={() => connect({ connector: connectors[0] })} style={{ width: '100%' }}>Connect wallet</button>}
        </Window>
      )}
      {phase === 'settled' && detail && detail.winner !== null && (() => {
        const oriented = orientResult(
          viewerRole(address, detail.creator, detail.acceptor),
          {
            winner: detail.winner,
            creatorScore: detail.creatorScore ?? 0,
            acceptorScore: detail.acceptorScore ?? 0,
            creatorDeathTick: detail.creatorDeathTick,
            acceptorDeathTick: detail.acceptorDeathTick,
          },
        );
        return (
          <Window title={`DUEL_${detail.id}.EXE — settled`}>
            <DuelResult
              {...oriented}
              amount={oriented.won ? (Number(stakeStr) * 1.9).toFixed(2) : stakeStr}
              symbol={symbol}
              settleTx={detail.settleTx}
            />
            <div className="row spread" style={{ marginTop: 10 }}>
              {!oriented.observer && !oriented.won && (
                <button onClick={() => router.push(`/duels/new?challenge=${detail.creator}`)}>Rematch</button>
              )}
              <button onClick={() => router.push('/duels')}>Back to duels</button>
            </div>
          </Window>
        );
      })()}
      {phase === 'funded' && detail && (() => {
        const role = viewerRole(address, detail.creator, detail.acceptor);
        if (role !== 'creator') {
          return (
            <Window title={`DUEL_${detail.id}.EXE`}>
              <p>This duel isn&apos;t open yet — its creator hasn&apos;t finished their run.</p>
              <button onClick={() => router.push('/duels')}>Back to duels</button>
            </Window>
          );
        }
        if (resumeScore !== null) {
          return (
            <Window title={`DUEL_${detail.id}.EXE — run saved`}>
              <p>✅ Your run is in (score {resumeScore}). The duel is now open for challengers.</p>
              <button onClick={() => router.push('/duels')}>Back to duels</button>
            </Window>
          );
        }
        if (resumeSeed === null) {
          return (
            <Window title={`DUEL_${detail.id}.EXE — unfinished`}>
              <p style={{ fontSize: 12 }}>⚠️ You funded this duel but didn&apos;t finish your run, and
                the game can&apos;t be recovered on this device. Your {stakeStr} {symbol} stake can be
                reclaimed 24 hours after creation — reopen this page then to refund it.</p>
              <button onClick={() => router.push('/duels')}>Back to duels</button>
            </Window>
          );
        }
        if (resumeStarted) {
          return (
            <Window title={`DUEL_${detail.id}.EXE — finish your run`}>
              <GameCanvas seed={resumeSeed} onRunEnd={onCreatorRunEnd} />
            </Window>
          );
        }
        return (
          <Window title={`DUEL_${detail.id}.EXE — finish your run`}>
            <p style={{ fontSize: 12 }}>You funded this duel but never finished your run. Play it now
              to open it for challengers.</p>
            <button onClick={() => setResumeStarted(true)} style={{ width: '100%' }}>Finish your run</button>
          </Window>
        );
      })()}
      {(phase === 'approving' || phase === 'accepting' || phase === 'binding') && (
        <Dialog95 title="Accepting duel…" open>
          <TxProgress
            title={`Staking ${symbol} to accept`}
            steps={[`Approve ${symbol}`, 'Lock your stake', 'Confirm on-chain']}
            active={phase === 'approving' ? 0 : phase === 'accepting' ? 1 : 2}
          />
        </Dialog95>
      )}
      {phase === 'playing' && ghost && (
        <Window title="GHOSTRACE.EXE — beat the grey bird">
          <GameCanvas seed={ghost.seed} ghostTaps={ghost.ghostTaps} onRunEnd={onRunEnd} />
        </Window>
      )}
      {phase === 'submitting' && (
        <Dialog95 title="Settling duel…" open>
          <TxProgress title="Verifying &amp; settling" steps={['Verify your run', 'Settle on-chain']} active={0} />
        </Dialog95>
      )}
      {phase === 'result' && outcome && detail && (
        <Dialog95 title={iWon ? 'Victory' : tie ? 'Draw' : 'Defeat'} open>
          <DuelResult
            won={iWon}
            tie={tie}
            amount={iWon ? (Number(stakeStr) * 1.9).toFixed(2) : stakeStr}
            symbol={symbol}
            yourScore={outcome.acceptorScore}
            theirScore={outcome.creatorScore}
            settleTx={outcome.settleTx}
          />
          <div className="row spread" style={{ marginTop: 10 }}>
            {!iWon && !tie && (
              <button onClick={() => router.push(`/duels/new?challenge=${detail.creator}`)}>Rematch</button>
            )}
            <button onClick={() => router.push('/duels')}>Close</button>
          </div>
        </Dialog95>
      )}
      {phase === 'pending' && detail && (() => {
        const playing = detail.status === 'accepted';
        const yours = viewerRole(address, detail.creator, detail.acceptor) !== 'observer';
        return (
          <Window title={`DUEL_${detail.id}.EXE — in progress`}>
            <p>{playing ? '⏳ The challenger is playing their run.' : '⏳ The result is in — settling on-chain.'}</p>
            <p style={{ fontSize: 12 }}>
              Both stakes (<span className="stake">{stakeStr} {symbol}</span> each) are held by the escrow until
              this finishes{yours ? '' : ' — you are not one of the two players'}.{' '}
              {playing
                ? 'Nothing to do yet: the result appears here as soon as they finish.'
                : 'The payout goes out automatically once the transaction confirms.'}
            </p>
            <p className="fineprint">
              If it is still stuck 24 hours after the duel was accepted, reload this page and it will
              offer to refund both players.
            </p>
            <div className="row">
              <button onClick={() => window.location.reload()}>Check again</button>
              <button onClick={() => router.push('/duels')}>Back to duels</button>
            </div>
          </Window>
        );
      })()}
      {phase === 'reclaim' && detail && reclaimKind === 'refundStale' && (
        <Window title={`DUEL_${detail.id}.EXE — stuck`}>
          <p>⚠️ This duel was accepted but never settled for over 24 hours.</p>
          <p style={{ fontSize: 12 }}>
            Releasing it refunds <b>both players</b> their <span className="stake">{stakeStr} {symbol}</span> stake.
            Anyone can trigger this — the funds always go back to the two players, whoever pays the network fee.
          </p>
          {isConnected
            ? <button onClick={reclaim} style={{ width: '100%' }}>Release both stakes</button>
            : <button onClick={() => connect({ connector: connectors[0] })} style={{ width: '100%' }}>Connect wallet</button>}
        </Window>
      )}
      {phase === 'reclaim' && detail && reclaimKind === 'cancelExpired' && (
        <Window title={`DUEL_${detail.id}.EXE — expired`}>
          <p>⚠️ Nobody accepted this duel within 24 hours, so it has expired.</p>
          <p style={{ fontSize: 12 }}>
            Cancelling it returns the <span className="stake">{stakeStr} {symbol}</span> stake to the creator
            (<span className="mono">{displayName(names, detail.creator)}</span>). No opponent ever staked, so that is
            the only stake held. Anyone can trigger this — the refund goes to the creator either way.
          </p>
          {isConnected
            ? <button onClick={reclaim} style={{ width: '100%' }}>Cancel duel &amp; refund creator</button>
            : <button onClick={() => connect({ connector: connectors[0] })} style={{ width: '100%' }}>Connect wallet</button>}
        </Window>
      )}
      {phase === 'reclaiming' && (
        <Dialog95 title="Reclaiming…" open>
          <TxProgress
            title={reclaimKind === 'cancelExpired' ? 'Refunding the creator' : 'Refunding both stakes'}
            steps={['Confirm on-chain']}
            active={0}
          />
        </Dialog95>
      )}
      {phase === 'error' && (
        <Dialog95 title="Error" open onClose={() => router.push('/duels')}>
          {error && <ErrorReport error={error} />}
          <button onClick={() => router.push('/duels')}>Back to duels</button>
        </Dialog95>
      )}
    </main>
  );
}
