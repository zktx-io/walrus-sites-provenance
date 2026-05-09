import { SuiGrpcClient } from '@mysten/sui/grpc';

import type { Network } from '../types';

export { SuiGrpcClient as SuiClient } from '@mysten/sui/grpc';
export type { SuiClientTypes } from '@mysten/sui/client';

export type SuiObjectResponse = import('@mysten/sui/client').SuiClientTypes.Object;
export type TransactionEffects = import('@mysten/sui/client').SuiClientTypes.TransactionEffects;
export type TransactionInclude = import('@mysten/sui/client').SuiClientTypes.TransactionInclude;
export type TransactionResult<Include extends TransactionInclude = {}> =
  import('@mysten/sui/client').SuiClientTypes.TransactionResult<Include>;

export const getFullnodeUrl = (network: Network | 'devnet' | 'localnet'): string => {
  switch (network) {
    case 'mainnet':
      return 'https://fullnode.mainnet.sui.io:443';
    case 'testnet':
      return 'https://fullnode.testnet.sui.io:443';
    case 'devnet':
      return 'https://fullnode.devnet.sui.io:443';
    case 'localnet':
      return 'http://127.0.0.1:9000';
    default:
      network satisfies never;
      throw new Error(`Unsupported Sui network: ${network}`);
  }
};

export const isSuiGrpcClient = (client: unknown): client is SuiGrpcClient =>
  client instanceof SuiGrpcClient;
