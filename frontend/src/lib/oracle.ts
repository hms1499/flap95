import { createWalletClient, http, zeroAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';
import { publicClient } from './chain';
import { ESCROW_ADDRESS, USDM_ADDRESS, duelEscrowAbi } from './contracts';

export function decideWinner(creatorScore: number, acceptorScore: number): 'creator' | 'acceptor' | 'tie' {
  if (creatorScore > acceptorScore) return 'creator';
  if (acceptorScore > creatorScore) return 'acceptor';
  return 'tie';
}

function oracleAccount() {
  return privateKeyToAccount(process.env.ORACLE_PRIVATE_KEY as Hex);
}

export function oracleAddress(): Address {
  return oracleAccount().address;
}

const settleTypes = {
  Settle: [
    { name: 'duelId', type: 'uint256' },
    { name: 'winner', type: 'address' },
    { name: 'scoreA', type: 'uint32' },
    { name: 'scoreB', type: 'uint32' },
  ],
} as const;

export async function signSettle(duelId: bigint, winner: Address, scoreA: number, scoreB: number): Promise<Hex> {
  return oracleAccount().signTypedData({
    domain: { name: 'Flap95', version: '1', chainId: celo.id, verifyingContract: ESCROW_ADDRESS },
    types: settleTypes,
    primaryType: 'Settle',
    message: { duelId, winner, scoreA, scoreB },
  });
}

/**
 * How long relaySettle waits for a receipt before giving up on it.
 *
 * viem's default is 180s — three times the reconcile route's 60s maxDuration. Since that
 * route's wall-clock budget is only checked *between* loop iterations, a single un-mined
 * settle tx on the default would keep awaiting until the platform killed the invocation
 * mid-flight, taking the tx hash and the whole JSON response with it. Callers must reserve
 * at least this much of their own budget before calling (see the reconcile loop).
 */
export const RELAY_RECEIPT_TIMEOUT_MS = 20_000;

/**
 * Submits settle() from the oracle account and waits for it to be mined.
 * Returns the tx hash only on a confirmed successful receipt, or null if relaying failed.
 *
 * Awaiting the receipt is what makes a revert read as failure. Returning the hash at
 * broadcast time made a reverted settle() look like success, so callers wrote the terminal
 * 'settled' status while the chain still held both stakes — a state excluded from the
 * reconcile candidates, the reclaim UI, and /refunded alike, i.e. unrecoverable. On failure
 * the row stays 'settling' and the existing retry machinery picks it up again.
 *
 * A timeout is reported as failure like any other, which is safe but not free: the tx may
 * still land afterwards. The row stays 'settling', and the reconciler's chain pre-flight
 * sees Settled on a later tick and syncs the row without relaying again. The hash survives
 * only in the log line below, so keep it greppable.
 */
export async function relaySettle(
  duelId: bigint, winner: Address, scoreA: number, scoreB: number,
): Promise<Hex | null> {
  // Hoisted so the catch can report it: on a receipt timeout this hash is the only trace of
  // a tx that may yet be mined, and losing it means losing the ability to reconcile by hand.
  let hash: Hex | undefined;
  try {
    const sig = await signSettle(duelId, winner, scoreA, scoreB);
    const wallet = createWalletClient({ account: oracleAccount(), chain: celo, transport: http('https://forno.celo.org') });
    hash = await wallet.writeContract({
      address: ESCROW_ADDRESS, abi: duelEscrowAbi, functionName: 'settle',
      args: [duelId, winner, scoreA, scoreB, sig],
      feeCurrency: USDM_ADDRESS,
    });
    const receipt = await publicClient.waitForTransactionReceipt({
      hash, timeout: RELAY_RECEIPT_TIMEOUT_MS,
    });
    if (receipt.status !== 'success') {
      // Log the hash so the revert is traceable on-chain — the gas was really spent.
      console.error('relaySettle reverted on-chain', { duelId: duelId.toString(), hash });
      return null;
    }
    return hash;
  } catch (err) {
    console.error('relaySettle failed', { duelId: duelId.toString(), hash, err });
    return null;
  }
}

export { zeroAddress };
