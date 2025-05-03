import { SuiClient, SuiMoveNormalizedType } from '@mysten/sui/client';
import { normalizeStructTag, parseStructTag } from '@mysten/sui/utils';
import {
  WalrusClient,
  MAINNET_WALRUS_PACKAGE_CONFIG,
  TESTNET_WALRUS_PACKAGE_CONFIG,
} from '@mysten/walrus';

import { Network } from '../types';

export interface WalrusSystem {
  walCoinType: string;
  systemObjectId: string;
  systemPackageId: string;
  blobPackageId: string;
  subsidiesObjectId?: string;
  subsidiesPackageId?: string;
  sitePackageId: string;
}

const toTypeString = (type: SuiMoveNormalizedType): string => {
  if (typeof type === 'string') {
    switch (type) {
      case 'Address':
        return 'address';
      case 'Bool':
        return 'bool';
      case 'U8':
        return 'u8';
      case 'U16':
        return 'u16';
      case 'U32':
        return 'u32';
      case 'U64':
        return 'u64';
      case 'U128':
        return 'u128';
      case 'U256':
        return 'u256';
      default:
        throw new Error(`Unexpected type ${type}`);
    }
  }

  if ('Vector' in type) {
    return `vector<${toTypeString(type.Vector)}>`;
  }

  if ('Struct' in type) {
    if (type.Struct.typeArguments.length > 0) {
      return `${type.Struct.address}::${type.Struct.module}::${type.Struct.name}<${type.Struct.typeArguments.map(toTypeString).join(',')}>`;
    } else {
      return `${type.Struct.address}::${type.Struct.module}::${type.Struct.name}`;
    }
  }

  if ('TypeParameter' in type) {
    throw new Error(`Type parameters can't be converted to type strings`);
  }

  if ('Reference' in type) {
    return toTypeString(type.Reference);
  }

  if ('MutableReference' in type) {
    return toTypeString(type.MutableReference);
  }

  throw new Error(`Unexpected type ${JSON.stringify(type)}`);
};

const getWalCoinType = async (suiClient: SuiClient, packageId: string): Promise<string> => {
  const stakedWal = await suiClient.getNormalizedMoveStruct({
    package: packageId,
    module: 'staked_wal',
    struct: 'StakedWal',
  });

  const balanceType = stakedWal.fields.find(field => field.name === 'principal')?.type;

  if (!balanceType) {
    throw new Error('WAL type not found');
  }

  const parsed = parseStructTag(toTypeString(balanceType));
  const coinType = parsed.typeParams[0];

  if (!coinType) {
    throw new Error('WAL type not found');
  }

  return normalizeStructTag(coinType);
};

const getSubsidiesPackageId = async (
  suiClient: SuiClient,
  subsidiesObjectId: string,
): Promise<string> => {
  const subsidiesObject = await suiClient.getObject({
    id: subsidiesObjectId,
    options: { showType: true },
  });
  const subsidiesPackageId = parseStructTag(subsidiesObject.data?.type!).address;

  return subsidiesPackageId;
};

export const loadWalrusSystem = async (
  network: Network,
  suiClient: SuiClient,
  walrusClient: WalrusClient,
): Promise<WalrusSystem> => {
  const system = await walrusClient.systemObject();
  const walCoinType = await getWalCoinType(suiClient, system.package_id);
  let subsidiesPackageId: string | undefined = undefined;

  if (
    (network === 'testnet' && TESTNET_WALRUS_PACKAGE_CONFIG.subsidiesObjectId) ||
    (network === 'mainnet' && MAINNET_WALRUS_PACKAGE_CONFIG.subsidiesObjectId)
  ) {
    const subsidiesObject = await suiClient.getObject({
      id:
        network === 'testnet'
          ? TESTNET_WALRUS_PACKAGE_CONFIG.subsidiesObjectId
          : MAINNET_WALRUS_PACKAGE_CONFIG.subsidiesObjectId,
      options: { showType: true },
    });
    subsidiesPackageId = parseStructTag(subsidiesObject.data?.type!).address;
  }

  return network === 'testnet'
    ? {
        walCoinType,
        systemObjectId: system.id.id,
        systemPackageId: system.package_id,
        blobPackageId: system.package_id,
        subsidiesObjectId: TESTNET_WALRUS_PACKAGE_CONFIG.subsidiesObjectId,
        subsidiesPackageId,
        sitePackageId: '0xf99aee9f21493e1590e7e5a9aea6f343a1f381031a04a732724871fc294be799',
      }
    : {
        walCoinType,
        systemObjectId: system.id.id,
        systemPackageId: system.package_id,
        blobPackageId: system.package_id,
        subsidiesObjectId: MAINNET_WALRUS_PACKAGE_CONFIG.subsidiesObjectId,
        subsidiesPackageId,
        sitePackageId: '0x26eb7ee8688da02c5f671679524e379f0b837a12f1d1d799f255b7eea260ad27',
      };
};
