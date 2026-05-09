import { normalizeStructTag } from '@mysten/sui/utils';
import { WalrusClient } from '@mysten/walrus';

import { Network } from '../types';

import { SuiClient } from './suiClient';

export interface WalrusSystem {
  walCoinType: string;
  blobPackageId: string;
  sitePackageId: string;
}

const getWalCoinType = async (suiClient: SuiClient, packageId: string): Promise<string> => {
  const stakeWithPool = await suiClient.getMoveFunction({
    packageId,
    moduleName: 'staking',
    name: 'stake_with_pool',
  });
  const toStake = stakeWithPool.function.parameters[1];
  const toStakeCoin = toStake?.body.$kind === 'datatype' ? toStake.body.datatype : null;
  const toStakeCoinType =
    toStakeCoin?.typeParameters[0]?.$kind === 'datatype' ? toStakeCoin.typeParameters[0] : null;

  if (toStakeCoinType?.$kind !== 'datatype') {
    throw new Error('WAL type not found');
  }

  return normalizeStructTag(toStakeCoinType.datatype.typeName);
};

export const loadWalrusSystem = async (
  network: Network,
  suiClient: SuiClient,
  walrusClient: WalrusClient,
): Promise<WalrusSystem> => {
  const system = await walrusClient.systemObject();
  const blobPackageId = (await walrusClient.getBlobType()).split('::')[0];
  const walCoinType = await getWalCoinType(suiClient, system.package_id);

  return network === 'testnet'
    ? {
        walCoinType,
        blobPackageId,
        sitePackageId: '0xf99aee9f21493e1590e7e5a9aea6f343a1f381031a04a732724871fc294be799',
      }
    : {
        walCoinType,
        blobPackageId,
        sitePackageId: '0x26eb7ee8688da02c5f671679524e379f0b837a12f1d1d799f255b7eea260ad27',
      };
};
