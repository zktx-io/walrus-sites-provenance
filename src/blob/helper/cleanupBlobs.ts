import * as core from '@actions/core';
import { SuiClient } from '@mysten/sui/client';
import { Signer } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';

import { SiteConfig } from '../../types';
import { WalrusSystem } from '../../utils/loadWalrusSystem';

import { deleteBlobs } from './walrus/deleteBlobs';

export const cleanupBlobs = async ({
  signer,
  suiClient,
  config,
  walrusSystem,
  blobObjectsIds,
}: {
  signer: Signer;
  suiClient: SuiClient;
  config: SiteConfig;
  walrusSystem: WalrusSystem;
  blobObjectsIds: string[];
}) => {
  const tx = new Transaction();
  tx.setGasBudget(config.gas_budget);
  tx.add(
    deleteBlobs({
      owner: config.owner,
      packageId: walrusSystem.blobPackageId,
      blobObjectsIds,
      systemObjectId: walrusSystem.systemObjectId,
    }),
  );
  const { digest } = await suiClient.signAndExecuteTransaction({
    signer,
    transaction: tx,
  });
  const receipt = await suiClient.waitForTransaction({
    digest,
    options: { showEffects: true, showEvents: true },
  });
  core.info(`🗑️  blobs deleted successfully, tx digest: ${digest}`);
  blobObjectsIds.forEach(blobObjectId => {
    core.info(` - Removed blob object ID: ${blobObjectId}`);
  });
};
