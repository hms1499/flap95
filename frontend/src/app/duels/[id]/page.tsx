'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useConnect, usePublicClient, useWriteContract } from 'wagmi';
import { formatUnits } from 'viem';
import { Window } from '@/components/Window';
import { Dialog95 } from '@/components/Dialog95';
import { GameCanvas } from '@/components/GameCanvas';
import { ESCROW_ADDRESS, duelEscrowAbi, erc20Abi, tokenByAddress } from '@/lib/contracts';
import { feeCurrencyOverrides } from '@/lib/minipay';

type Phase = 'loading' | 'preview' | 'approving' | 'accepting' | 'binding' | 'playing' | 'submitting' | 'result' | 'error';

interface Detail { id: number; onchainId: string; status: string; stakeWei: string; token: string | null; creator: string }
interface Outcome { winner: 'creator' | 'acceptor' | 'tie'; creatorScore: number; acceptorScore: number; settleTx: string | null }

export default function DuelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [phase, setPhase] = useState<Phase>('loading');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [ghost, setGhost] = useState<{ seed: number; ghostTaps: number[] } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/duels/${id}`).then((r) => r.json()).then((d) => {
      setDetail(d);
      setPhase(d.status === 'open' ? 'preview' : 'error');
      if (d.status !== 'open') setError('This duel is not open.');
    });
  }, [id]);

  async function accept() {
    if (!detail || !address || !publicClient) return;
    const stakeToken = detail.token ? tokenByAddress(detail.token) : undefined;
    if (!stakeToken) { setError('Unknown stake currency.'); setPhase('error'); return; }
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
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setPhase('error');
    }
  }

  const onRunEnd = useCallback(async (taps: number[]) => {
    setPhase('submitting');
    const res = await fetch(`/api/duels/${id}/replay`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'acceptor', taps }),
    });
    if (!res.ok) { setError('Replay rejected'); setPhase('error'); return; }
    setOutcome(await res.json());
    setPhase('result');
  }, [id]);

  const duelToken = detail?.token ? tokenByAddress(detail.token) : undefined;
  const symbol = duelToken?.symbol ?? 'USDm';
  const stakeStr = detail ? formatUnits(BigInt(detail.stakeWei), duelToken?.decimals ?? 18) : '';
  const iWon = outcome?.winner === 'acceptor';
  const tie = outcome?.winner === 'tie';

  return (
    <main className="desktop">
      {phase === 'loading' && <Window title="DUEL.EXE"><p>Loading…</p></Window>}
      {phase === 'preview' && detail && (
        <Window title={`DUEL_${detail.id}.EXE`}>
          <p>⚔️ Stake: <b>{stakeStr} {symbol}</b> · vs {detail.creator.slice(0, 8)}…</p>
          <p style={{ fontSize: 12 }}>Same pipes, same physics. Beat their ghost, take the pot (minus 5% fee). Scores stay hidden until you finish — no sniping.</p>
          {isConnected
            ? <button onClick={accept} style={{ width: '100%' }}>Accept duel — stake {stakeStr} {symbol}</button>
            : <button onClick={() => connect({ connector: connectors[0] })} style={{ width: '100%' }}>Connect wallet</button>}
        </Window>
      )}
      {(phase === 'approving' || phase === 'accepting' || phase === 'binding') && (
        <Dialog95 title="Please wait…" open>
          <p>⏳ {phase === 'approving' ? `Approving ${symbol}…` : phase === 'accepting' ? 'Locking your stake…' : 'Confirming on-chain…'}</p>
          <progress style={{ width: '100%' }} />
        </Dialog95>
      )}
      {phase === 'playing' && ghost && (
        <Window title="GHOSTRACE.EXE — beat the grey bird">
          <GameCanvas seed={ghost.seed} ghostTaps={ghost.ghostTaps} onRunEnd={onRunEnd} />
        </Window>
      )}
      {phase === 'submitting' && (
        <Dialog95 title="Please wait…" open><p>⏳ Verifying and settling on-chain…</p><progress style={{ width: '100%' }} /></Dialog95>
      )}
      {phase === 'result' && outcome && detail && (
        <Dialog95 title={iWon ? 'Victory' : tie ? 'Draw' : 'Defeat'} open>
          <p>
            {iWon && <>🏆 You won <b>{(Number(stakeStr) * 1.9).toFixed(2)} {symbol}</b>!</>}
            {tie && <>🤝 Tie — both stakes refunded.</>}
            {!iWon && !tie && <>⚠️ You lost <b>{stakeStr} {symbol}</b>.</>}
          </p>
          <p>You {outcome.acceptorScore} — {outcome.creatorScore} them.</p>
          {outcome.settleTx && (
            <p style={{ fontSize: 12 }}>
              <a href={`https://celoscan.io/tx/${outcome.settleTx}`} target="_blank" rel="noreferrer">View settlement ↗</a>
            </p>
          )}
          <div className="row spread">
            {!iWon && !tie && (
              <button onClick={() => router.push(`/duels/new?challenge=${detail.creator}`)}>Rematch</button>
            )}
            <button onClick={() => router.push('/duels')}>Close</button>
          </div>
        </Dialog95>
      )}
      {phase === 'error' && (
        <Dialog95 title="Error" open onClose={() => router.push('/duels')}>
          <p>⚠️ {error}</p>
          <button onClick={() => router.push('/duels')}>Back to duels</button>
        </Dialog95>
      )}
    </main>
  );
}
