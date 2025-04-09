import { SuiClient } from '@mysten/sui/client';
import { convert } from './convert';

const printBalance = (
  symbol: string,
  { amount, decimals }: { amount: string; decimals: number },
) => {
  console.log(`${symbol}: ${convert({ amount, decimals })}`);
};

export const accountState = async (
  owner: string,
  suiClient: SuiClient,
  walCoinType: string,
): Promise<bigint> => {
  const balances = await suiClient.getAllBalances({
    owner,
  });
  const sui = balances.find(balance => balance.coinType === '0x2::sui::SUI');
  const wal = balances.find(balance => balance.coinType === walCoinType);
  const suiData = await suiClient.getCoinMetadata({
    coinType: '0x2::sui::SUI',
  });
  const walData = await suiClient.getCoinMetadata({
    coinType: walCoinType,
  });

  console.log(`Adr: ${owner}`);
  printBalance('Sui', {
    amount: sui?.totalBalance || '0',
    decimals: suiData?.decimals || 0,
  });
  printBalance('Wal', {
    amount: wal?.totalBalance || '0',
    decimals: walData?.decimals || 0,
  });

  return BigInt(wal?.totalBalance || '0');
};
