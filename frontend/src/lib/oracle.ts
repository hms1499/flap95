import { createWalletClient, http, zeroAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';
import { ESCROW_ADDRESS, USDM_ADDRESS, duelEscrowAbi } from './contracts';

export function decideWinner(creatorScore: number, acceptorScore: number): 'creator' | 'acceptor' | 'tie' {
  if (creatorScore > acceptorScore) return 'creator';
  if (acceptorScore > creatorScore) return 'acceptor';
  return 'tie';
}

function oracleAccount() {
  return privateKeyToAccount(process.env.ORACLE_PRIVATE_KEY as Hex);
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

/** Submits settle() from the oracle account. Returns tx hash, or null if relaying failed. */
export async function relaySettle(
  duelId: bigint, winner: Address, scoreA: number, scoreB: number,
): Promise<Hex | null> {
  try {
    const sig = await signSettle(duelId, winner, scoreA, scoreB);
    const wallet = createWalletClient({ account: oracleAccount(), chain: celo, transport: http('https://forno.celo.org') });
    return await wallet.writeContract({
      address: ESCROW_ADDRESS, abi: duelEscrowAbi, functionName: 'settle',
      args: [duelId, winner, scoreA, scoreB, sig],
      feeCurrency: USDM_ADDRESS,
    });
  } catch (err) {
    console.error('relaySettle failed', err);
    return null;
  }
}

export { zeroAddress };
