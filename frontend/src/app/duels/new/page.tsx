'use client';
import { Suspense, useCallback, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAccount, useConnect, usePublicClient, useWriteContract } from 'wagmi';
import { formatUnits } from 'viem';
import { Window } from '@/components/Window';
import { Dialog95 } from '@/components/Dialog95';
import { GameCanvas } from '@/components/GameCanvas';
import { TxProgress } from '@/components/TxProgress';
import { ESCROW_ADDRESS, STAKE_TOKENS, type StakeToken, stakeTiersWei, duelEscrowAbi, erc20Abi } from '@/lib/contracts';
import { feeCurrencyOverrides } from '@/lib/minipay';
import { friendlyError, type FriendlyError } from '@/lib/friendlyError';
import { ErrorReport } from '@/components/ErrorReport';
import { saveDuelSeed, clearDuelSeed } from '@/lib/duelSeedStore';
import { useNames, displayName } from '@/lib/useNames';

type Phase = 'pick-stake' | 'approving' | 'depositing' | 'binding' | 'playing' | 'submitting' | 'done' | 'error';

function CreateDuel() {
  const search = useSearchParams();
  const router = useRouter();
  const challenge = search.get('challenge') ?? undefined;
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [phase, setPhase] = useState<Phase>('pick-stake');
  const [token, setToken] = useState<StakeToken>(STAKE_TOKENS[0]);
  // The chosen tier is held as an index, not as a wei amount: switching currency rebuilds
  // the tier list, and an index carries the player's "middle tier" choice across that
  // switch where a raw bigint would silently become an amount they never picked.
  const [tier, setTier] = useState(0);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [duel, setDuel] = useState<{ id: number; seed: number } | null>(null);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const names = useNames([challenge]);

  async function start(stake: bigint) {
    if (!address || !publicClient) return;
    try {
      const res = await fetch('/api/duels', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ creator: address, challengeTo: challenge }),
      });
      const draft = await res.json();
      setDuel(draft);
      // Stash the seed so the creator can finish this run later if they abandon it
      // before it is recorded (the seed is never re-served by any API).
      saveDuelSeed(localStorage, draft.id, draft.seed);

      setPhase('approving');
      const allowance = await publicClient.readContract({
        address: token.address, abi: erc20Abi, functionName: 'allowance', args: [address, ESCROW_ADDRESS],
      });
      if (allowance < stake) {
        const approveTx = await writeContractAsync({
          address: token.address, abi: erc20Abi, functionName: 'approve',
          args: [ESCROW_ADDRESS, stake], ...feeCurrencyOverrides(),
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
      }

      setPhase('depositing');
      const createTx = await writeContractAsync({
        address: ESCROW_ADDRESS, abi: duelEscrowAbi, functionName: 'createDuel',
        args: [token.address, stake], ...feeCurrencyOverrides(),
      });

      setPhase('binding');
      const bind = await fetch(`/api/duels/${draft.id}/bind`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txHash: createTx }),
      });
      if (!bind.ok) throw new Error('bind failed');
      setPhase('playing');
    } catch (e) {
      setError(friendlyError(e));
      setPhase('error');
    }
  }

  const onRunEnd = useCallback(async (taps: number[], score: number) => {
    if (!duel) return;
    setPhase('submitting');
    const res = await fetch(`/api/duels/${duel.id}/replay`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'creator', taps }),
    });
    if (!res.ok) { setError({ message: 'Replay rejected' }); setPhase('error'); return; }
    const data = await res.json();
    clearDuelSeed(localStorage, duel.id);
    setFinalScore(data.score);
    setPhase('done');
  }, [duel]);

  if (!isConnected) {
    return (
      <Window title="NEWDUEL.EXE">
        <p>Connect your wallet to create a duel.</p>
        <button onClick={() => connect({ connector: connectors[0] })}>Connect wallet</button>
      </Window>
    );
  }

  return (
    <>
      {phase === 'pick-stake' && (
        <Window title="NEWDUEL.EXE — pick your stake">
          {challenge && <p className="fineprint">Rematch challenge vs <span className="mono">{displayName(names, challenge)}</span></p>}
          <fieldset>
            <legend>Currency</legend>
            <div className="row">
              {STAKE_TOKENS.map((t) => (
                <button
                  key={t.symbol}
                  onClick={() => setToken(t)}
                  style={{ flex: 1, fontWeight: t.symbol === token.symbol ? 'bold' : 'normal' }}
                  aria-pressed={t.symbol === token.symbol}
                >
                  {t.symbol}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset style={{ marginTop: 8 }}>
            <legend>Stake — winner takes the pot</legend>
            <div className="row">
              {stakeTiersWei(token).map((s, i) => (
                <button
                  key={s.toString()}
                  onClick={() => setTier(i)}
                  style={{ flex: 1, fontWeight: i === tier ? 'bold' : 'normal' }}
                  aria-pressed={i === tier}
                >
                  <span className="win">{formatUnits(s, token.decimals)}</span> {token.symbol}
                </button>
              ))}
            </div>
          </fieldset>
          <p className="fineprint">Winner takes the pot minus a 5% house fee. Ties refund both players. Your challenger stakes the same currency.</p>
          {/* Selecting a tier used to send the transaction, so a row of buttons that looked
              exactly like the currency row above it — which only selects — spent real money
              on first tap. Committing now needs this separate, explicitly worded action. */}
          <button onClick={() => start(stakeTiersWei(token)[tier])} style={{ width: '100%', marginTop: 8 }}>
            Create duel — stake {formatUnits(stakeTiersWei(token)[tier], token.decimals)} {token.symbol}
          </button>
        </Window>
      )}
      {(phase === 'approving' || phase === 'depositing' || phase === 'binding') && (
        <Dialog95 title="Creating duel…" open>
          <TxProgress
            title={`Staking ${token.symbol}`}
            steps={[`Approve ${token.symbol}`, 'Deposit your stake', 'Confirm on-chain']}
            active={phase === 'approving' ? 0 : phase === 'depositing' ? 1 : 2}
          />
        </Dialog95>
      )}
      {phase === 'playing' && duel && (
        <Window title="NEWDUEL.EXE — your run. Make it count.">
          <GameCanvas seed={duel.seed} onRunEnd={onRunEnd} />
        </Window>
      )}
      {phase === 'submitting' && (
        <Dialog95 title="Please wait…" open>
          <TxProgress title="Verifying your run" steps={['Verify your run', 'Open the duel']} active={0} />
        </Dialog95>
      )}
      {phase === 'done' && (
        <Dialog95 title="Duel is live" onClose={() => router.push('/duels')} open>
          <p>✅ You scored <b>{finalScore}</b>. Your duel is now open for challengers.</p>
          <button onClick={() => router.push('/duels')}>View open duels</button>
        </Dialog95>
      )}
      {phase === 'error' && (
        <Dialog95 title="Error" onClose={() => setPhase('pick-stake')} open>
          {error && <ErrorReport error={error} />}
          <button onClick={() => setPhase('pick-stake')}>Try again</button>
        </Dialog95>
      )}
    </>
  );
}

export default function NewDuelPage() {
  return (
    <main className="desktop">
      <Suspense><CreateDuel /></Suspense>
    </main>
  );
}
