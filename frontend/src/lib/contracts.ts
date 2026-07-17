export const ESCROW_ADDRESS = process.env.NEXT_PUBLIC_ESCROW_ADDRESS as `0x${string}`;
export const USDM_ADDRESS = (process.env.NEXT_PUBLIC_USDM_ADDRESS ??
  '0x765DE816845861e75A25fCA122bb6898B8B1282a') as `0x${string}`;

export const STAKE_TIERS_WEI = [100000000000000000n, 500000000000000000n, 1000000000000000000n] as const;

export const duelEscrowAbi = [
  { type: 'function', name: 'createDuel', stateMutability: 'nonpayable',
    inputs: [{ name: 'stake', type: 'uint96' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'acceptDuel', stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'settle', stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' }, { name: 'winner', type: 'address' },
      { name: 'scoreA', type: 'uint32' }, { name: 'scoreB', type: 'uint32' },
      { name: 'sig', type: 'bytes' },
    ], outputs: [] },
  { type: 'function', name: 'cancelExpired', stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
  { type: 'event', name: 'DuelCreated', inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'stake', type: 'uint96', indexed: false }] },
  { type: 'event', name: 'DuelAccepted', inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'acceptor', type: 'address', indexed: true }] },
  { type: 'event', name: 'DuelSettled', inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'winner', type: 'address', indexed: false },
      { name: 'scoreA', type: 'uint32', indexed: false },
      { name: 'scoreB', type: 'uint32', indexed: false }] },
] as const;

export const erc20Abi = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;
