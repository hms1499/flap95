import { USDM_ADDRESS } from './contracts';

interface MiniPayEthereum { isMiniPay?: boolean }

export function isMiniPay(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as { ethereum?: MiniPayEthereum }).ethereum?.isMiniPay);
}

export function feeCurrencyOverrides(): { feeCurrency?: `0x${string}` } {
  return isMiniPay() ? { feeCurrency: USDM_ADDRESS } : {};
}
