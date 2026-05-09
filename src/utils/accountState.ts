import * as core from '@actions/core';

import { convert } from './convert';
import { SuiClient } from './suiClient';

const printBalance = (
  symbol: string,
  { amount, decimals }: { amount: string; decimals: number },
) => {
  core.info(`${symbol}: ${convert({ amount, decimals })}`);
};

export const accountState = async (
  owner: string,
  network: string,
  suiClient: SuiClient,
  walCoinType: string,
): Promise<bigint> => {
  const { balances } = await suiClient.listBalances({
    owner,
  });
  const sui = balances.find(balance => balance.coinType === '0x2::sui::SUI');
  const wal = balances.find(balance => balance.coinType === walCoinType);
  const { coinMetadata: suiData } = await suiClient.getCoinMetadata({
    coinType: '0x2::sui::SUI',
  });
  const { coinMetadata: walData } = await suiClient.getCoinMetadata({
    coinType: walCoinType,
  });

  core.info(`🌐 Network: ${network}`);
  core.info(`📍 Adr: ${owner}`);
  printBalance('💧 Sui', {
    amount: sui?.balance || '0',
    decimals: suiData?.decimals || 0,
  });
  printBalance('🦭 Wal', {
    amount: wal?.balance || '0',
    decimals: walData?.decimals || 0,
  });

  return BigInt(wal?.balance || '0');
};
