import * as core from '@actions/core';
import { SuiClient } from '@mysten/sui/client';
import { Signer } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import { WalrusClient } from '@mysten/walrus';

import { BlobDictionary, SiteConfig } from '../types';
import { GitSigner } from '../utils/gitSigner';
import { hexToBase36 } from '../utils/hexToBase36';
import { WalrusSystem } from '../utils/loadWalrusSystem';

import { addRoutes } from './helper/addRoutes';
import { deleteOldBlobs } from './helper/deleteOldBlobs';
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
  transaction.setGasBudget(config.gas_budget);

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

  // Execute transaction
  const { digest } = await suiClient.signAndExecuteTransaction({
    signer,
    transaction,
  });

  const receipt = await suiClient.waitForTransaction({
    digest,
    options: { showEffects: true, showEvents: true },
  });

  if (receipt.errors) {
    console.error('❌ Update site failed:', receipt.errors);
    throw new Error('Update site failed');
  } else {
    core.info(`🚀 Site updated successfully, tx digest: ${digest}`);
  }

  if (batchedCommands.length > 1) {
    const tx = new Transaction();
    tx.setGasBudget(config.gas_budget);
    batchedCommands
      .slice(1)
      .forEach(batch =>
        batch.forEach(option => tx.add(registerResources({ ...option, site: siteObjectId }))),
      );
    const { digest: digest2 } = await suiClient.signAndExecuteTransaction({
      signer,
      transaction: tx,
    });
    const receipt2 = await suiClient.waitForTransaction({
      digest: digest2,
      options: { showEffects: true, showEvents: true },
    });
    core.info(`🚀 Add Resurces successfully, tx digest: ${digest2}`);
  }

  // Cleanup old blobs
  if (oldBlobObjects.length > 0) {
    const tx = new Transaction();
    tx.setGasBudget(config.gas_budget);
    tx.add(
      deleteOldBlobs({
        owner: config.owner,
        packageId: walrusSystem.blobPackageId,
        oldBlobObjects,
        systemObjectId: walrusSystem.systemObjectId,
      }),
    );
    const { digest: digest3 } = await suiClient.signAndExecuteTransaction({
      signer,
      transaction: tx,
    });
    const receipt3 = await suiClient.waitForTransaction({
      digest,
      options: { showEffects: true, showEvents: true },
    });
    core.info(`🗑️  Old blobs deleted successfully, tx digest: ${digest3}`);
    oldBlobObjects.forEach(blobObjectId => {
      core.info(` - Removed blob object ID: ${blobObjectId}`);
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
