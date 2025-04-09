import { SuiClient, SuiMoveNormalizedType } from '@mysten/sui/client';
import { normalizeStructTag, parseStructTag } from '@mysten/sui/utils';
import {
  WalrusClient,
  MAINNET_WALRUS_PACKAGE_CONFIG,
  TESTNET_WALRUS_PACKAGE_CONFIG,
} from '@mysten/walrus';

export interface WalrusSystem {
  walCoinType: string;
  systemObjectId: string;
  blobPackageId: string;
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

export const getSubsidiesObjectId = (network: 'mainnet' | 'testnet') => {
  return network === 'testnet'
    ? TESTNET_WALRUS_PACKAGE_CONFIG.subsidiesObjectId
    : MAINNET_WALRUS_PACKAGE_CONFIG.subsidiesObjectId;
};

export const getSitePackageId = (network: 'mainnet' | 'testnet') => {
  return network === 'testnet'
    ? '0xf99aee9f21493e1590e7e5a9aea6f343a1f381031a04a732724871fc294be799'
    : '0x26eb7ee8688da02c5f671679524e379f0b837a12f1d1d799f255b7eea260ad27';
};

export const getSubsidiesPackageId = (network: 'mainnet' | 'testnet') => {
  return network === 'testnet'
    ? '0x015906b499d8cdc40f23ab94431bf3fe488a8548f8ae17199a72b2e9df341ca5'
    : '0xd843c37d213ea683ec3519abe4646fd618f52d7fce1c4e9875a4144d53e21ebc';
};

export const getWalrusSystem = async (
  network: 'mainnet' | 'testnet',
  suiClient: SuiClient,
  walrusClient: WalrusClient,
): Promise<WalrusSystem> => {
  const system = await walrusClient.systemObject();
  const walCoinType = await getWalCoinType(suiClient, system.package_id);

  return network === 'testnet'
    ? {
        walCoinType,
        systemObjectId: system.id.id,
        blobPackageId: system.package_id,
      }
    : {
        walCoinType,
        systemObjectId: system.id.id,
        blobPackageId: system.package_id,
      };
};
