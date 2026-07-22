import { formatUnits } from 'viem';

export const ESCROW_ADDRESS = process.env.NEXT_PUBLIC_ESCROW_ADDRESS as `0x${string}`;
export const USDM_ADDRESS = (process.env.NEXT_PUBLIC_USDM_ADDRESS ??
  '0x765DE816845861e75A25fCA122bb6898B8B1282a') as `0x${string}`;
export const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ??
  '0xcebA9300f2b948710d2653dD7B07f33A8B32118C') as `0x${string}`;
export const USDT_ADDRESS = (process.env.NEXT_PUBLIC_USDT_ADDRESS ??
  '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e') as `0x${string}`;

export interface StakeToken {
  symbol: 'USDm' | 'USDC' | 'USDT';
  address: `0x${string}`;
  decimals: number;
}

export const STAKE_TOKENS: readonly StakeToken[] = [
  { symbol: 'USDm', address: USDM_ADDRESS, decimals: 18 },
  { symbol: 'USDC', address: USDC_ADDRESS, decimals: 6 },
  { symbol: 'USDT', address: USDT_ADDRESS, decimals: 6 },
] as const;

export function tokenByAddress(address: string): StakeToken | undefined {
  const a = address.toLowerCase();
  return STAKE_TOKENS.find((t) => t.address.toLowerCase() === a);
}

/** Stake tiers 0.1 / 0.5 / 1 whole tokens, scaled to the token's decimals. */
export function stakeTiersWei(token: StakeToken): [bigint, bigint, bigint] {
  const unit = 10n ** BigInt(token.decimals);
  return [unit / 10n, unit / 2n, unit];
}

export const duelEscrowAbi = [
  { type: 'function', name: 'createDuel', stateMutability: 'nonpayable',
    inputs: [{ name: 'token', type: 'address' }, { name: 'stake', type: 'uint96' }],
    outputs: [{ type: 'uint256' }] },
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
  { type: 'function', name: 'refundStale', stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'duels', stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'creator', type: 'address' },
      { name: 'acceptor', type: 'address' },
      { name: 'stake', type: 'uint96' },
      { name: 'createdAt', type: 'uint40' },
      { name: 'status', type: 'uint8' },
      { name: 'token', type: 'address' },
      { name: 'acceptedAt', type: 'uint40' },
    ] },
  { type: 'event', name: 'DuelCreated', inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'stake', type: 'uint96', indexed: false },
      { name: 'token', type: 'address', indexed: false }] },
  { type: 'event', name: 'DuelAccepted', inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'acceptor', type: 'address', indexed: true }] },
  { type: 'event', name: 'DuelSettled', inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'winner', type: 'address', indexed: false },
      { name: 'scoreA', type: 'uint32', indexed: false },
      { name: 'scoreB', type: 'uint32', indexed: false }] },
  { type: 'event', name: 'DuelCancelled', inputs: [
      { name: 'id', type: 'uint256', indexed: true }] },
  { type: 'event', name: 'DuelRefunded', inputs: [
      { name: 'id', type: 'uint256', indexed: true }] },
] as const;

/** Human-readable stake, e.g. "0.5 cUSD". Falls back to "—" for unfunded rows. */
export function formatStake(stakeWei: string | null, token: string | null): string {
  if (!stakeWei) return '—';
  const t = token ? tokenByAddress(token) : undefined;
  return `${formatUnits(BigInt(stakeWei), t?.decimals ?? 18)} ${t?.symbol ?? 'USDm'}`;
}

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
