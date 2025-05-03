import * as core from '@actions/core';
import { SuiClient } from '@mysten/sui/client';
import { Signer } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import { WalrusClient } from '@mysten/walrus';

import { cleanupBlobs } from '../blob/helper/cleanupBlobs';
import { BlobDictionary, SiteConfig } from '../types';
import { failWithMessage } from '../utils/failWithMessage';
import { GitSigner } from '../utils/gitSigner';
import { hexToBase36 } from '../utils/hexToBase36';
import { WalrusSystem } from '../utils/loadWalrusSystem';

import { addRoutes } from './helper/addRoutes';
import { generateBatchedResourceCommands } from './helper/generateBatchedResourceCommands';
import { getOldBlobObjects } from './helper/getOldBlobObjects';
import { getResourceObjects } from './helper/getResourceObjects';
import { registerResources, RegisterResourcesOption } from './helper/registerResources';

export const updateSite = async ({
  config,
  suiClient,
  walrusClient,
  walrusSystem,
  blobs,
  siteObjectId,
  signer,
  isGitSigner,
}: {
  config: SiteConfig;
  suiClient: SuiClient;
  walrusClient: WalrusClient;
  walrusSystem: WalrusSystem;
  blobs: BlobDictionary;
  siteObjectId: string;
  signer: Signer;
  isGitSigner: boolean;
}) => {
  const transaction = new Transaction();

  // Get old blob object IDs
  const oldBlobObjects = await getOldBlobObjects({
    packageId: walrusSystem.blobPackageId,
    config,
    suiClient,
    walrusClient,
  });

  // Remove existing resources
  const existingResources = await getResourceObjects({
    suiClient,
    siteObjectId,
  });

  for (const { path } of existingResources) {
    transaction.moveCall({
      target: `${walrusSystem.sitePackageId}::site::remove_resource_if_exists`,
      arguments: [transaction.object(siteObjectId), transaction.pure.string(path)],
    });
  }

  // Register new resources
  const batchedCommands: RegisterResourcesOption[][] = generateBatchedResourceCommands({
    blobs,
    packageId: walrusSystem.sitePackageId,
    site: siteObjectId,
  });

  if (batchedCommands.length === 0) {
    throw new Error('No resources to register');
  }

  batchedCommands[0].forEach(option => transaction.add(registerResources(option)));

  // Recreate routes
  transaction.add(
    addRoutes({
      packageId: walrusSystem.sitePackageId,
      site: siteObjectId,
      blobs,
      isUpdate: true,
    }),
  );

  // dry run transaction to estimate gas
  const { input } = await suiClient.dryRunTransactionBlock({
    transactionBlock: await transaction.build({ client: suiClient }),
  });
  transaction.setSender(signer.toSuiAddress());
  transaction.setGasBudget(parseInt(input.gasData.budget));

  // Execute transaction
  const { digest } = await suiClient.signAndExecuteTransaction({
    signer,
    transaction,
  });

  const { effects } = await suiClient.waitForTransaction({
    digest,
    options: { showEffects: true },
  });

  if (effects!.status.status !== 'success') {
    core.setFailed(
      `Transaction ${digest} is ${effects!.status.status}: ${JSON.stringify(effects!.status.error)}`,
    );
    throw new Error('Update site failed');
  } else {
    core.info(`🚀 Site updated successfully, tx digest: ${digest}`);
  }

  if (batchedCommands.length > 1) {
    const tx = new Transaction();
    batchedCommands
      .slice(1)
      .forEach(batch =>
        batch.forEach(option => tx.add(registerResources({ ...option, site: siteObjectId }))),
      );
    const { input: input2 } = await suiClient.dryRunTransactionBlock({
      transactionBlock: await tx.build({ client: suiClient }),
    });
    tx.setSender(signer.toSuiAddress());
    tx.setGasBudget(parseInt(input2.gasData.budget));
    const { digest: digest2 } = await suiClient.signAndExecuteTransaction({
      signer,
      transaction: tx,
    });

    const { effects: effects2 } = await suiClient.waitForTransaction({
      digest: digest2,
      options: { showEffects: true, showEvents: true },
    });

    if (effects2!.status.status !== 'success') {
      failWithMessage(
        `Transaction ${digest2} is ${effects2!.status.status}: ${JSON.stringify(effects2!.status.error)}`,
      );
    } else {
      core.info(`🚀 Add Resurces successfully, tx digest: ${digest2}`);
    }
  }

  // Cleanup old blobs
  if (oldBlobObjects.length > 0) {
    await cleanupBlobs({
      signer,
      suiClient,
      config,
      walrusSystem,
      blobObjectsIds: oldBlobObjects,
    });
  } else {
    core.info(`🗑️  No old blobs to delete.`);
  }

  const b36 = hexToBase36(siteObjectId);
  core.info(`\n📦 Site object ID: ${siteObjectId}`);
  if (config.network === 'mainnet') {
    const url = `https://${b36}.wal.app`;
    core.info(`🌐 ${url}`);
    core.info(`👉 You can now register this site on SuiNS using the object ID above.`);
    if (isGitSigner) {
      const message = new TextEncoder().encode(JSON.stringify({ url }));
      await (signer as GitSigner).signPersonalMessage(message, true);
    }
  } else {
    const url = `http://${b36}.localhost:3000`;
    core.info(`🌐 ${url}`);
    core.info(`👉 You can test this Walrus Site locally.`);
    if (isGitSigner) {
      const message = new TextEncoder().encode(JSON.stringify({ url }));
      await (signer as GitSigner).signPersonalMessage(message, true);
    }
  }
};
