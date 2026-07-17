'use client';
import { Suspense, useCallback, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAccount, useConnect, usePublicClient, useWriteContract } from 'wagmi';
import { formatEther } from 'viem';
import { Window } from '@/components/Window';
import { Dialog95 } from '@/components/Dialog95';
import { GameCanvas } from '@/components/GameCanvas';
import { ESCROW_ADDRESS, USDM_ADDRESS, STAKE_TIERS_WEI, duelEscrowAbi, erc20Abi } from '@/lib/contracts';
import { feeCurrencyOverrides } from '@/lib/minipay';

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
  const [error, setError] = useState('');
  const [duel, setDuel] = useState<{ id: number; seed: number } | null>(null);
  const [finalScore, setFinalScore] = useState<number | null>(null);

  async function start(stake: bigint) {
    if (!address || !publicClient) return;
    try {
      const res = await fetch('/api/duels', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ creator: address, challengeTo: challenge }),
      });
      const draft = await res.json();
      setDuel(draft);

      setPhase('approving');
      const allowance = await publicClient.readContract({
        address: USDM_ADDRESS, abi: erc20Abi, functionName: 'allowance', args: [address, ESCROW_ADDRESS],
      });
      if (allowance < stake) {
        const approveTx = await writeContractAsync({
          address: USDM_ADDRESS, abi: erc20Abi, functionName: 'approve',
          args: [ESCROW_ADDRESS, stake], ...feeCurrencyOverrides(),
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
      }

      setPhase('depositing');
      const createTx = await writeContractAsync({
        address: ESCROW_ADDRESS, abi: duelEscrowAbi, functionName: 'createDuel',
        args: [stake], ...feeCurrencyOverrides(),
      });

      setPhase('binding');
      const bind = await fetch(`/api/duels/${draft.id}/bind`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txHash: createTx }),
      });
      if (!bind.ok) throw new Error('bind failed');
      setPhase('playing');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
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
    if (!res.ok) { setError('Replay rejected'); setPhase('error'); return; }
    const data = await res.json();
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
          {challenge && <p>Rematch challenge vs {challenge.slice(0, 8)}…</p>}
          <div className="row">
            {STAKE_TIERS_WEI.map((s) => (
              <button key={s.toString()} onClick={() => start(s)} style={{ flex: 1 }}>
                {formatEther(s)} USDm
              </button>
            ))}
          </div>
          <p style={{ fontSize: 12 }}>Winner takes the pot minus a 5% house fee. Ties refund both players.</p>
        </Window>
      )}
      {(phase === 'approving' || phase === 'depositing' || phase === 'binding') && (
        <Dialog95 title="Please wait…" open>
          <p>⏳ {phase === 'approving' ? 'Approving USDm…' : phase === 'depositing' ? 'Depositing your stake…' : 'Confirming on-chain…'}</p>
          <progress style={{ width: '100%' }} />
        </Dialog95>
      )}
      {phase === 'playing' && duel && (
        <Window title="NEWDUEL.EXE — your run. Make it count.">
          <GameCanvas seed={duel.seed} onRunEnd={onRunEnd} />
        </Window>
      )}
      {phase === 'submitting' && (
        <Dialog95 title="Please wait…" open><p>⏳ Verifying your run…</p><progress style={{ width: '100%' }} /></Dialog95>
      )}
      {phase === 'done' && (
        <Dialog95 title="Duel is live" onClose={() => router.push('/duels')} open>
          <p>✅ You scored <b>{finalScore}</b>. Your duel is now open for challengers.</p>
          <button onClick={() => router.push('/duels')}>View open duels</button>
        </Dialog95>
      )}
      {phase === 'error' && (
        <Dialog95 title="Error" onClose={() => setPhase('pick-stake')} open>
          <p>⚠️ {error}</p>
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
