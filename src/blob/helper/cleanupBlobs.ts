import * as core from '@actions/core';
import { SuiClient } from '@mysten/sui/client';
import { Signer } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';

import { SiteConfig } from '../../types';
import { failWithMessage } from '../../utils/failWithMessage';
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
  const transaction = new Transaction();
  transaction.add(
    deleteBlobs({
      owner: config.owner,
      packageId: walrusSystem.blobPackageId,
      blobObjectsIds,
      systemObjectId: walrusSystem.systemObjectId,
    }),
  );

  // dry run transaction to estimate gas
  const { input } = await suiClient.dryRunTransactionBlock({
    transactionBlock: await transaction.build({ client: suiClient }),
  });
  transaction.setSender(signer.toSuiAddress());
  transaction.setGasBudget(parseInt(input.gasData.budget));

  const { digest } = await suiClient.signAndExecuteTransaction({
    signer,
    transaction,
  });

  const { effects } = await suiClient.waitForTransaction({
    digest,
    options: { showEffects: true },
  });

  if (effects!.status.status !== 'success') {
    failWithMessage(
      `Transaction ${digest} is ${effects!.status.status}: ${JSON.stringify(effects!.status.error)}`,
    );
  } else {
    core.info(`🗑️  blobs deleted successfully, tx digest: ${digest}`);
    blobObjectsIds.forEach(blobObjectId => {
      core.info(` - Removed blob object ID: ${blobObjectId}`);
    });
  }
};
